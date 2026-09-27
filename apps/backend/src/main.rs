//! `mvp-backend`: serves the app's Riot-backed routes and platform services.
//!
//! ```text
//! RIOT_API_KEY=RGAPI-… cargo run -p mvp-backend      # listens on BIND (127.0.0.1:8787)
//! mvp-backend healthcheck                              # exit 0 if GET /health answers ok
//! mvp-backend release|config|reports …                 # admin commands (see admin.rs)
//! ```

use std::process::ExitCode;
use std::time::Duration;

use mvp_backend::{
    AppState, Ops, OpsSettings, Settings, admin, init_logging, live_riot_config, service,
};
use riot_api::RiotClient;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};

#[tokio::main]
async fn main() -> ExitCode {
    init_logging();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let settings = Settings::from_env().and_then(|s| Ok((s, OpsSettings::from_env()?)));
    let (settings, ops_settings) = match settings {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let result = if admin::is_admin(&args) {
        admin::run(&args, &ops_settings.data_dir, &mut std::io::stdout()).map_err(Into::into)
    } else {
        match args.first().map(String::as_str) {
            Some("healthcheck") => healthcheck(&settings).await,
            None => serve(settings, ops_settings).await,
            Some(_) => Err(admin::USAGE.into()),
        }
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!("{e}");
            ExitCode::FAILURE
        }
    }
}

async fn serve(
    settings: Settings,
    ops_settings: OpsSettings,
) -> Result<(), Box<dyn std::error::Error>> {
    if settings.riot_key.is_none() {
        tracing::warn!("RIOT_API_KEY is not set: Riot-backed routes will answer 503");
    }
    let client = settings
        .riot_key
        .clone()
        .map(|key| RiotClient::new(key, live_riot_config()))
        .transpose()?;
    if let Some(dir) = &settings.stats_dir {
        tracing::info!(dir = %dir.display(), "serving published stats");
    }
    let state = AppState::with_stats(client, settings.stats_dir.clone());
    tracing::info!(settings = ?ops_settings, "platform services");
    let ops = Ops::new(ops_settings)?;

    let snapshot = ops.snapshot_path();
    if let Some(path) = &snapshot {
        match state.load_riot_cache(path) {
            Ok(0) => {}
            Ok(n) => tracing::info!(entries = n, "restored the Riot caches"),
            Err(e) => tracing::warn!(error = %e, "cannot restore the Riot caches"),
        }
    }

    let router = service(&state, &settings.allowed_origins, &ops);
    let listener = tokio::net::TcpListener::bind(settings.bind).await?;
    tracing::info!(addr = %settings.bind, origins = ?settings.allowed_origins, "mvp-backend listening");

    if let Some(admin_bind) = ops.settings().admin_bind {
        let admin_listener = tokio::net::TcpListener::bind(admin_bind).await?;
        let admin_router = ops.admin_router(&state);
        tracing::info!(addr = %admin_bind, "metrics listening");
        tokio::spawn(async move {
            if let Err(e) = axum::serve(admin_listener, admin_router).await {
                tracing::error!(error = %e, "admin listener stopped");
            }
        });
    }

    let ops = std::sync::Arc::new(ops);
    let pruner = std::sync::Arc::clone(&ops);
    tokio::spawn(async move {
        let mut daily = tokio::time::interval(Duration::from_secs(24 * 60 * 60));
        loop {
            daily.tick().await;
            let ops = std::sync::Arc::clone(&pruner);
            let _ = tokio::task::spawn_blocking(move || ops.prune_reports()).await;
        }
    });

    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    if let Some(path) = &snapshot {
        match state.save_riot_cache(path) {
            Ok(0) => {}
            Ok(n) => tracing::info!(entries = n, "saved the Riot caches"),
            Err(e) => tracing::warn!(error = %e, "cannot save the Riot caches"),
        }
    }
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
    tracing::info!("shutting down: finishing in-flight requests");
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
