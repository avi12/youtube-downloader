//! One CDP session: a WebSocket to one target, request/reply correlation by command id, and the
//! two operations the reloads run in it.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use crate::driver::cdp::frames::FrameTreeResult;
use crate::driver::net::within;
use crate::error::{Error, Result};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);
/// The `Runtime.evaluate` result field present only when the expression threw.
const EXCEPTION_DETAILS_FIELD: &str = "exceptionDetails";

/// The CDP commands this client sends.
#[derive(Debug, Clone, Copy, Serialize)]
enum Method {
    #[serde(rename = "Runtime.evaluate")]
    RuntimeEvaluate,
    #[serde(rename = "Page.getFrameTree")]
    PageGetFrameTree,
    #[serde(rename = "Page.navigate")]
    PageNavigate,
}

#[derive(Debug, Serialize)]
struct Command {
    id: u64,
    method: Method,
    #[serde(rename = "params")]
    parameters: Value,
}

#[derive(Debug, Deserialize)]
struct Reply {
    id: Option<u64>,
    result: Option<Value>,
    error: Option<Value>,
}

/// One CDP session: a WebSocket to one target and a command counter.
pub(super) struct Session {
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    next_id: u64,
}

impl Session {
    async fn open(url: &str) -> Result<Self> {
        let (socket, _response) = within(
            CONNECT_TIMEOUT,
            "the CDP WebSocket handshake",
            connect_async(url),
        )
        .await?;
        Ok(Self { socket, next_id: 1 })
    }

    async fn close(mut self) {
        self.socket.close(None).await.ok();
    }

    async fn call(&mut self, method: Method, parameters: Value) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let payload = serde_json::to_string(&Command {
            id,
            method,
            parameters,
        })?;
        within(
            REPLY_TIMEOUT,
            "sending a CDP command",
            self.socket.send(Message::text(payload)),
        )
        .await?;
        within(REPLY_TIMEOUT, "a CDP reply", self.reply_to(id)).await
    }

    async fn reply_to(&mut self, id: u64) -> Result<Value> {
        while let Some(frame) = self.socket.next().await {
            let Message::Text(text) = frame? else {
                continue;
            };
            let reply: Reply = serde_json::from_str(text.as_str())?;
            if reply.id != Some(id) {
                continue;
            }
            if let Some(error) = reply.error {
                return Err(Error::Protocol(format!("CDP error: {error}")));
            }
            return Ok(reply.result.unwrap_or(Value::Null));
        }
        Err(WebSocketError::ConnectionClosed.into())
    }

    /// Runs `expression` (awaited, by value) in the target at `url`; a thrown exception is an error.
    pub(super) async fn evaluate(url: &str, expression: &str) -> Result<()> {
        let mut session = Self::open(url).await?;
        let parameters =
            json!({ "expression": expression, "awaitPromise": true, "returnByValue": true });
        let outcome = session.call(Method::RuntimeEvaluate, parameters).await;
        session.close().await;
        if let Some(details) = outcome?.get(EXCEPTION_DETAILS_FIELD) {
            return Err(Error::Protocol(format!("evaluation threw: {details}")));
        }
        Ok(())
    }

    /// Port of `reloadExtensionFrameInTab`: navigates the first frame of the target at `url` whose
    /// URL contains `needle` to its own URL; false when no frame matches.
    pub(super) async fn navigate_frame(url: &str, needle: &str) -> Result<bool> {
        let mut session = Self::open(url).await?;
        let outcome = session.navigate_matching_frame(needle).await;
        session.close().await;
        outcome
    }

    async fn navigate_matching_frame(&mut self, needle: &str) -> Result<bool> {
        let tree = self.call(Method::PageGetFrameTree, json!({})).await?;
        let parsed: FrameTreeResult = serde_json::from_value(tree)?;
        let Some(frame) = parsed
            .into_frames()
            .into_iter()
            .find(|candidate| candidate.url.contains(needle))
        else {
            return Ok(false);
        };
        let parameters = json!({ "url": frame.url, "frameId": frame.id });
        self.call(Method::PageNavigate, parameters).await?;
        Ok(true)
    }
}

/// Whether `error` is the session closing under us, which `location.reload()` causes.
pub(super) fn is_closed(error: &Error) -> bool {
    matches!(
        error,
        Error::WebSocket(inner)
            if matches!(**inner, WebSocketError::ConnectionClosed | WebSocketError::AlreadyClosed)
    )
}
