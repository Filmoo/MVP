//! The client's WebSocket event stream (WAMP 1.0 subset).

use std::sync::Arc;

use futures_util::{SinkExt as _, StreamExt as _};
use rustls::ClientConfig;
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::{self, Message};
use tokio_tungstenite::{Connector, MaybeTlsStream, WebSocketStream};

use crate::Credentials;

/// Subscribe to every client event (`OnJsonApiEvent`) or to one path
/// (`OnJsonApiEvent_lol-gameflow_v1_gameflow-phase`).
pub fn topic_for(path: &str) -> String {
    format!("OnJsonApiEvent{}", path.replace('/', "_"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventKind {
    Create,
    Update,
    Delete,
}

#[derive(Debug, Clone, PartialEq)]
pub struct LcuEvent {
    pub uri: String,
    pub kind: EventKind,
    pub data: Value,
}

#[derive(Debug, thiserror::Error)]
pub enum EventStreamError {
    #[error("websocket: {0}")]
    WebSocket(#[from] tungstenite::Error),
    #[error("invalid credentials header")]
    Header,
}

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Debug)]
pub struct EventStream {
    ws: Ws,
}

impl EventStream {
    /// Connects and subscribes to `topics`.
    pub async fn connect(
        credentials: &Credentials,
        tls: Arc<ClientConfig>,
        topics: &[String],
    ) -> Result<Self, EventStreamError> {
        let mut request = format!("wss://127.0.0.1:{}/", credentials.port).into_client_request()?;
        let auth = HeaderValue::from_str(&credentials.authorization())
            .map_err(|_| EventStreamError::Header)?;
        request.headers_mut().insert("Authorization", auth);
        let (mut ws, _) = tokio_tungstenite::connect_async_tls_with_config(
            request,
            None,
            false,
            Some(Connector::Rustls(tls)),
        )
        .await?;
        for topic in topics {
            ws.send(Message::Text(
                serde_json::json!([5, topic]).to_string().into(),
            ))
            .await?;
        }
        Ok(Self { ws })
    }

    /// Next event; `None` when the client closed the connection.
    pub async fn next(&mut self) -> Option<Result<LcuEvent, EventStreamError>> {
        loop {
            match self.ws.next().await? {
                Ok(Message::Text(text)) => {
                    if let Some(event) = parse_frame(text.as_str()) {
                        return Some(Ok(event));
                    }
                }
                Ok(Message::Close(_)) => return None,
                Ok(_) => {}
                Err(e) => return Some(Err(e.into())),
            }
        }
    }
}

/// Parses `[8, "<topic>", {"data": …, "eventType": "Update", "uri": "/…"}]`.
/// Anything else (welcome frames, malformed input) yields `None`.
pub fn parse_frame(text: &str) -> Option<LcuEvent> {
    let Value::Array(parts) = serde_json::from_str(text).ok()? else {
        return None;
    };
    if parts.first()?.as_u64()? != 8 {
        return None;
    }
    let payload = parts.get(2)?;
    let kind = match payload.get("eventType")?.as_str()? {
        "Create" => EventKind::Create,
        "Update" => EventKind::Update,
        "Delete" => EventKind::Delete,
        _ => return None,
    };
    Some(LcuEvent {
        uri: payload.get("uri")?.as_str()?.to_owned(),
        kind,
        data: payload.get("data").cloned().unwrap_or(Value::Null),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    #[test]
    fn parses_event_frames() {
        let frame = r#"[8,"OnJsonApiEvent",{"data":"ChampSelect","eventType":"Update","uri":"/lol-gameflow/v1/gameflow-phase"}]"#;
        let event = parse_frame(frame).expect("event");
        assert_eq!(event.uri, "/lol-gameflow/v1/gameflow-phase");
        assert_eq!(event.kind, EventKind::Update);
        assert_eq!(event.data, Value::String("ChampSelect".into()));
    }

    #[test]
    fn ignores_other_frames() {
        assert_eq!(parse_frame(r#"[0,"session",1,"server"]"#), None);
        assert_eq!(
            parse_frame(r#"[8,"t",{"eventType":"Weird","uri":"/x"}]"#),
            None
        );
        assert_eq!(parse_frame("not json"), None);
    }

    #[test]
    fn builds_topics() {
        assert_eq!(
            topic_for("/lol-champ-select/v1/session"),
            "OnJsonApiEvent_lol-champ-select_v1_session"
        );
    }

    proptest! {
        #[test]
        fn never_panics(s in ".*") {
            let _ = parse_frame(&s);
        }
    }
}
