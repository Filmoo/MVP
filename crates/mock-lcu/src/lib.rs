//! A fake League client for tests and for developing without League (or on Linux).
//!
//! Serves the LCU surface the app uses — HTTPS REST with basic auth and the WAMP 1.0
//! WebSocket event stream — from an in-memory map of JSON documents. Tests (or the
//! `mock-lcu` binary playing a scenario) change documents with [`MockLcu::set`], which also
//! pushes the matching `OnJsonApiEvent` to subscribers, exactly like the real client.
//!
//! TLS uses a throwaway CA generated at start; point the connector at [`MockLcu::ca_pem`].
//!
//! The client's write endpoints the app uses behave like the real ones (see `writes`): rune
//! pages with the page limit, item sets, the champion-select spell selection, the ready check.
//! Every request is recorded with its JSON body for assertions. [`history`] serves the local
//! player's match history: the list and whole games. [`game`] plays the game's own Live Client
//! Data API ([`MockLcu::start_game`]), on the same CA.

pub mod game;
pub mod history;
mod writes;

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex, PoisonError};

use axum::Router;
use axum::body::Body;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{FromRequestParts, State};
use axum::http::{HeaderMap, Method, Request, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use futures_util::{SinkExt as _, StreamExt as _};
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto::Builder as ConnBuilder;
use hyper_util::service::TowerToHyperService;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, watch};
use tokio::task::{JoinHandle, JoinSet};
use tokio_rustls::TlsAcceptor;

#[derive(Debug, thiserror::Error)]
pub enum MockError {
    #[error("certificate generation failed: {0}")]
    Cert(#[from] rcgen::Error),
    #[error(transparent)]
    Tls(#[from] rustls::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// One event pushed on the WebSocket (`[8, "OnJsonApiEvent", {…}]`).
#[derive(Debug, Clone)]
struct ApiEvent {
    uri: String,
    event_type: &'static str,
    data: Value,
}

/// One request as received.
#[derive(Debug, Clone)]
struct Received {
    method: Method,
    path: String,
    body: Option<Value>,
}

#[derive(Debug)]
struct Shared {
    password: String,
    docs: Mutex<HashMap<String, Value>>,
    requests: Mutex<Vec<Received>>,
    events: broadcast::Sender<ApiEvent>,
    /// Flipped on drop: open web sockets close, like when the real client quits.
    shutdown: watch::Sender<bool>,
}

impl Shared {
    fn get(&self, path: &str) -> Option<Value> {
        lock(&self.docs).get(path).cloned()
    }

    fn set(&self, path: &str, value: Value) {
        let existed = lock(&self.docs)
            .insert(path.to_owned(), value.clone())
            .is_some();
        let _ = self.events.send(ApiEvent {
            uri: path.to_owned(),
            event_type: if existed { "Update" } else { "Create" },
            data: value,
        });
    }

    /// The player answers the current ready check (from the client UI or through the API).
    fn respond_to_ready_check(&self, response: &str) -> bool {
        let current = lock(&self.docs).get(READY_CHECK).cloned();
        let Some(mut check) = current else {
            return false;
        };
        check["playerResponse"] = json!(response);
        self.set(READY_CHECK, check);
        true
    }

    fn authorized(&self, headers: &HeaderMap) -> bool {
        let expected = format!(
            "Basic {}",
            STANDARD.encode(format!("riot:{}", self.password))
        );
        headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            == Some(expected.as_str())
    }
}

/// A running fake client. Dropping it stops the server.
#[derive(Debug)]
pub struct MockLcu {
    addr: SocketAddr,
    ca_pem: String,
    /// The server certificate, signed by the CA: the fake game serves with it too.
    tls: Arc<rustls::ServerConfig>,
    shared: Arc<Shared>,
    server: JoinHandle<()>,
}

impl Drop for MockLcu {
    fn drop(&mut self) {
        self.shared.shutdown.send_replace(true);
        self.server.abort();
    }
}

impl MockLcu {
    /// Starts on a random loopback port with a fresh CA and password.
    pub async fn start() -> Result<Self, MockError> {
        let (ca_pem, server_config) = tls_material()?;
        let tls = Arc::new(server_config);
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let addr = listener.local_addr()?;
        let (events, _) = broadcast::channel(256);
        let shared = Arc::new(Shared {
            password: format!("mock-{}", addr.port()),
            docs: Mutex::new(HashMap::new()),
            requests: Mutex::new(Vec::new()),
            events,
            shutdown: watch::channel(false).0,
        });
        let app = Router::new()
            .fallback(handle)
            .with_state(Arc::clone(&shared));
        let server = serve(listener, Arc::clone(&tls), app);
        let mock = Self {
            addr,
            ca_pem,
            tls,
            shared,
            server,
        };
        mock.set(GAMEFLOW_PHASE, json!("None"));
        Ok(mock)
    }

    /// Starts the game's own Live Client Data API next to this client, on a random loopback
    /// port and the same CA (the real game serves on the League client's root).
    pub async fn start_game(&self) -> Result<game::MockGame, MockError> {
        game::MockGame::start(Arc::clone(&self.tls)).await
    }

    pub fn port(&self) -> u16 {
        self.addr.port()
    }

    pub fn password(&self) -> &str {
        &self.shared.password
    }

    /// PEM of the CA that signed the server certificate.
    pub fn ca_pem(&self) -> &str {
        &self.ca_pem
    }

    /// Content of a lockfile pointing at this server.
    pub fn lockfile(&self) -> String {
        format!(
            "LeagueClient:{}:{}:{}:https",
            std::process::id(),
            self.port(),
            self.password()
        )
    }

    /// Sets the document served at `path` and pushes an `Update`/`Create` event for it.
    pub fn set(&self, path: &str, value: Value) {
        self.shared.set(path, value);
    }

    /// Removes the document at `path` (404 afterwards) and pushes a `Delete` event.
    pub fn remove(&self, path: &str) {
        lock(&self.shared.docs).remove(path);
        let _ = self.shared.events.send(ApiEvent {
            uri: path.to_owned(),
            event_type: "Delete",
            data: Value::Null,
        });
    }

    /// The document served at `path` now (after the app's writes), if any.
    pub fn get(&self, path: &str) -> Option<Value> {
        self.shared.get(path)
    }

    /// Every request received so far, as `(method, path)`.
    pub fn requests(&self) -> Vec<(String, String)> {
        lock(&self.shared.requests)
            .iter()
            .map(|r| (r.method.to_string(), r.path.clone()))
            .collect()
    }

    /// How many `method path` requests were received.
    pub fn count(&self, method: &str, path: &str) -> usize {
        lock(&self.shared.requests)
            .iter()
            .filter(|r| r.method.as_str() == method && r.path == path)
            .count()
    }

    /// How many requests with `method` were received, whatever the path (e.g. every `DELETE`).
    pub fn count_method(&self, method: &str) -> usize {
        lock(&self.shared.requests)
            .iter()
            .filter(|r| r.method.as_str() == method)
            .count()
    }

    /// JSON bodies of the `method path` requests received so far, oldest first.
    pub fn bodies(&self, method: &str, path: &str) -> Vec<Value> {
        lock(&self.shared.requests)
            .iter()
            .filter(|r| r.method.as_str() == method && r.path == path)
            .filter_map(|r| r.body.clone())
            .collect()
    }

    /// A match is found: the ready check pops up (nobody answered yet) and the gameflow phase
    /// turns to `ReadyCheck`. `POST …/ready-check/accept|decline` answer it like the client does.
    pub fn start_ready_check(&self) {
        self.set(
            READY_CHECK,
            json!({ "state": "InProgress", "playerResponse": "None", "timer": 0.0, "declinerIds": [], "dodgeWarning": "None", "suppressUx": false }),
        );
        self.set(GAMEFLOW_PHASE, json!("ReadyCheck"));
    }

    /// The player clicks Decline in the client.
    pub fn decline_ready_check(&self) {
        self.shared.respond_to_ready_check("Declined");
    }

    /// The player clicks Accept in the client.
    pub fn accept_ready_check(&self) {
        self.shared.respond_to_ready_check("Accepted");
    }

    /// The ready check is over (everyone answered or it timed out): the client moves to `phase`.
    pub fn end_ready_check(&self, phase: &str) {
        self.remove(READY_CHECK);
        self.set(GAMEFLOW_PHASE, json!(phase));
    }
}

const GAMEFLOW_PHASE: &str = "/lol-gameflow/v1/gameflow-phase";

/// The current ready check (404 when there is none).
pub const READY_CHECK: &str = "/lol-matchmaking/v1/ready-check";
/// Accepts the current ready check.
pub const READY_CHECK_ACCEPT: &str = "/lol-matchmaking/v1/ready-check/accept";
/// Declines the current ready check.
pub const READY_CHECK_DECLINE: &str = "/lol-matchmaking/v1/ready-check/decline";

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Serves `app` over TLS on `listener` until the returned task is aborted.
fn serve(listener: TcpListener, tls: Arc<rustls::ServerConfig>, app: Router) -> JoinHandle<()> {
    let acceptor = TlsAcceptor::from(tls);
    tokio::spawn(async move {
        // Connections live in this set: aborting the server aborts them all.
        let mut connections = JoinSet::new();
        loop {
            tokio::select! {
                accepted = listener.accept() => {
                    let Ok((tcp, _)) = accepted else { break };
                    let acceptor = acceptor.clone();
                    let service = TowerToHyperService::new(app.clone());
                    connections.spawn(async move {
                        let Ok(tls) = acceptor.accept(tcp).await else { return };
                        let _ = ConnBuilder::new(TokioExecutor::new())
                            .serve_connection_with_upgrades(TokioIo::new(tls), service)
                            .await;
                    });
                }
                Some(_) = connections.join_next() => {}
            }
        }
    })
}

/// Largest request body read (the client's documents are far smaller).
const BODY_LIMIT: usize = 1024 * 1024;

async fn handle(State(shared): State<Arc<Shared>>, req: Request<Body>) -> Response {
    let (mut parts, body) = req.into_parts();
    let path = parts.uri.path().to_owned();
    if path == "/" {
        record(&shared, &parts.method, path, None);
        if !shared.authorized(&parts.headers) {
            return lcu_error(StatusCode::UNAUTHORIZED, "Unauthorized");
        }
        return match WebSocketUpgrade::from_request_parts(&mut parts, &shared).await {
            Ok(ws) => ws.on_upgrade(move |socket| wamp(socket, shared)),
            Err(rejection) => rejection.into_response(),
        };
    }
    let body = axum::body::to_bytes(body, BODY_LIMIT)
        .await
        .ok()
        .filter(|bytes| !bytes.is_empty())
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    record(&shared, &parts.method, path, body.clone());
    if !shared.authorized(&parts.headers) {
        return lcu_error(StatusCode::UNAUTHORIZED, "Unauthorized");
    }
    route(&shared, &parts.method, &parts.uri, body.as_ref())
}

fn record(shared: &Shared, method: &Method, path: String, body: Option<Value>) {
    lock(&shared.requests).push(Received {
        method: method.clone(),
        path,
        body,
    });
}

fn route(shared: &Shared, method: &Method, uri: &Uri, body: Option<&Value>) -> Response {
    if let Some(response) = writes::route(shared, method, uri.path(), body) {
        return response;
    }
    let answer = match (method, uri.path()) {
        (&Method::POST, READY_CHECK_ACCEPT) => Some("Accepted"),
        (&Method::POST, READY_CHECK_DECLINE) => Some("Declined"),
        _ => None,
    };
    if let Some(response) = answer {
        return if shared.respond_to_ready_check(response) {
            StatusCode::NO_CONTENT.into_response()
        } else {
            lcu_error(StatusCode::NOT_FOUND, "No ready check")
        };
    }
    let docs = lock(&shared.docs);
    match (method, docs.get(uri.path())) {
        (&Method::GET, Some(value)) => (StatusCode::OK, axum::Json(value.clone())).into_response(),
        (&Method::GET, None) => lcu_error(StatusCode::NOT_FOUND, "Not found"),
        _ => StatusCode::NO_CONTENT.into_response(),
    }
}

/// The real client's error shape.
fn lcu_error(status: StatusCode, message: &str) -> Response {
    let body =
        json!({ "errorCode": "RPC_ERROR", "httpStatus": status.as_u16(), "message": message });
    (status, axum::Json(body)).into_response()
}

/// WAMP 1.0 subset: `[5, topic]` subscribes, `[6, topic]` unsubscribes, events go out as
/// `[8, topic, {data, eventType, uri}]`.
async fn wamp(socket: WebSocket, shared: Arc<Shared>) {
    let (mut tx, mut rx) = socket.split();
    let mut events = shared.events.subscribe();
    let mut shutdown = shared.shutdown.subscribe();
    let mut topics: HashSet<String> = HashSet::new();
    loop {
        tokio::select! {
            _ = shutdown.changed() => {
                let _ = tx.send(Message::Close(None)).await;
                break;
            }
            incoming = rx.next() => {
                let Some(Ok(Message::Text(text))) = incoming else { break };
                if let Ok(Value::Array(msg)) = serde_json::from_str::<Value>(text.as_str()) {
                    match (msg.first().and_then(Value::as_u64), msg.get(1).and_then(Value::as_str)) {
                        (Some(5), Some(topic)) => { topics.insert(topic.to_owned()); }
                        (Some(6), Some(topic)) => { topics.remove(topic); }
                        _ => {}
                    }
                }
            }
            event = events.recv() => {
                let Ok(event) = event else { continue };
                let specific = format!("OnJsonApiEvent{}", event.uri.replace('/', "_"));
                for topic in ["OnJsonApiEvent", specific.as_str()] {
                    if topics.contains(topic) {
                        let frame = json!([8, topic, { "data": event.data, "eventType": event.event_type, "uri": event.uri }]);
                        if tx.send(Message::Text(frame.to_string().into())).await.is_err() {
                            return;
                        }
                    }
                }
            }
        }
    }
}

/// A throwaway CA and a server certificate it signs. The server certificate is issued for
/// `localhost` only, like the real client's: connectors must not rely on hostname checks.
fn tls_material() -> Result<(String, rustls::ServerConfig), MockError> {
    let ca_key = rcgen::KeyPair::generate()?;
    let mut ca_params = rcgen::CertificateParams::new(Vec::<String>::new())?;
    ca_params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
    ca_params
        .distinguished_name
        .push(rcgen::DnType::CommonName, "Mock LoL CA");
    let ca_cert = ca_params.self_signed(&ca_key)?;
    let issuer = rcgen::Issuer::new(ca_params, ca_key);

    let server_key = rcgen::KeyPair::generate()?;
    let server_params = rcgen::CertificateParams::new(vec!["localhost".to_owned()])?;
    let server_cert = server_params.signed_by(&server_key, &issuer)?;

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()?
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(server_cert.der().to_vec())],
            PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(server_key.serialize_der())),
        )?;
    Ok((ca_cert.pem(), config))
}
