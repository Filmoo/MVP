//! `mvp-backend`: serves the app's Riot-backed routes.
//!
//! ```text
//! RIOT_API_KEY=RGAPI-… cargo run -p mvp-backend      # listens on BIND (127.0.0.1:8787)
//! mvp-backend healthcheck                              # exit 0 if GET /health answers ok
//! ```

use std::process::ExitCode;
use std::time::Duration;

use mvp_backend::{AppState, Settings, app, live_riot_config};
use riot_api::RiotClient;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let settings = match Settings::from_env() {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let result = if std::env::args().nth(1).as_deref() == Some("healthcheck") {
        healthcheck(&settings).await
    } else {
        serve(settings).await
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!("{e}");
            ExitCode::FAILURE
        }
    }
}

async fn serve(settings: Settings) -> Result<(), Box<dyn std::error::Error>> {
    if settings.riot_key.is_none() {
        tracing::warn!("RIOT_API_KEY is not set: Riot-backed routes will answer 503");
    }
    let client = settings
        .riot_key
        .clone()
        .map(|key| RiotClient::new(key, live_riot_config()))
        .transpose()?;
    let router = app(AppState::new(client), &settings.allowed_origins);
    let listener = tokio::net::TcpListener::bind(settings.bind).await?;
    tracing::info!(addr = %settings.bind, origins = ?settings.allowed_origins, "mvp-backend listening");
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutting down");
}

/// Minimal HTTP/1.0 probe of `/health` on `BIND`, for Docker's HEALTHCHECK (the runtime image
/// has no curl).
async fn healthcheck(settings: &Settings) -> Result<(), Box<dyn std::error::Error>> {
    let mut addr = settings.bind;
    if addr.ip().is_unspecified() {
        addr.set_ip(std::net::Ipv4Addr::LOCALHOST.into());
    }
    let probe = async {
        let mut stream = tokio::net::TcpStream::connect(addr).await?;
        stream
            .write_all(b"GET /health HTTP/1.0\r\nHost: localhost\r\n\r\n")
            .await?;
        let mut response = String::new();
        stream.read_to_string(&mut response).await?;
        Ok::<_, std::io::Error>(response)
    };
    let response = tokio::time::timeout(Duration::from_secs(3), probe).await??;
    if response.starts_with("HTTP/1.0 200") || response.starts_with("HTTP/1.1 200") {
        Ok(())
    } else {
        Err(format!("unhealthy: {}", response.lines().next().unwrap_or_default()).into())
    }
}
