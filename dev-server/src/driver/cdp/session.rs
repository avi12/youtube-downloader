//! One CDP session: a WebSocket to one target, request/reply correlation by command id, and the
//! two operations the reloads run in it.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::{Error as WebSocketError, Message};
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

use super::frames::FrameTreeResult;
use super::protocol::{encode_command, EvaluateParams, Incoming, Method, NoParams};
use crate::driver::net::within;
use crate::error::{Error, Result};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);
/// The part of a `Runtime.evaluate` result this client reads.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Outcome {
    /// Present only when the expression threw; printed as Chrome sent it.
    exception_details: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NavigateParams<'frame> {
    url: &'frame str,
    frame_id: &'frame str,
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

    async fn call<P: Serialize + Sync>(&mut self, method: Method, params: &P) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let payload = encode_command(id, method, params)?;
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
            let reply: Incoming = serde_json::from_str(text.as_str())?;
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
        let params = EvaluateParams::awaited(expression);
        let outcome = session.call(Method::RuntimeEvaluate, &params).await;
        session.close().await;
        let Outcome { exception_details } = serde_json::from_value(outcome?)?;
        if let Some(details) = exception_details {
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
        let tree = self.call(Method::PageGetFrameTree, &NoParams {}).await?;
        let parsed: FrameTreeResult = serde_json::from_value(tree)?;
        let Some(frame) = parsed
            .into_frames()
            .into_iter()
            .find(|candidate| candidate.url.contains(needle))
        else {
            return Ok(false);
        };
        let params = NavigateParams {
            url: &frame.url,
            frame_id: &frame.id,
        };
        self.call(Method::PageNavigate, &params).await?;
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
