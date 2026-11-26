//! One CDP session: a WebSocket to one target, replies matched to commands by id, events queued.

use std::collections::VecDeque;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::net::TcpStream;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use ytdl_dev_hot::driver::cdp::protocol::{encode_command, EvaluateParams, Incoming, Method};
use ytdl_dev_hot::driver::cdp::CdpTarget;

use super::error::{CdpError, Result};
use super::events::{Event, ExceptionDetails, ExecutionContext};
use super::targets::open_target;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const DEFAULT_REPLY_TIMEOUT: Duration = Duration::from_secs(30);

/// The `message` of a failed command.
#[derive(Debug, Deserialize)]
struct ErrorBody {
    message: String,
}

/// A value or an object living in the page.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteObject {
    /// The value, when it was asked by value: arbitrary page data.
    pub(crate) value: Option<Value>,
    /// The handle, when the object stays in the page.
    pub(crate) object_id: Option<String>,
}

/// The result of `Runtime.evaluate`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EvaluateReply {
    /// What the expression produced.
    #[serde(default)]
    pub(crate) result: RemoteObject,
    exception_details: Option<ExceptionDetails>,
}

/// What an evaluation produced: the JSON value, or the page's exception message.
#[derive(Debug)]
pub(crate) struct Evaluation {
    /// The value, `null` when the expression had none.
    pub(crate) value: Value,
    /// The message of the exception the expression threw.
    pub(crate) exception: Option<String>,
}

impl Evaluation {
    /// The value, or the page's exception as an error.
    pub(crate) fn into_value(self) -> Result<Value> {
        match self.exception {
            Some(message) => Err(CdpError::Exception(message)),
            None => Ok(self.value),
        }
    }
}

/// One evaluation in an execution context.
pub(crate) struct ContextEvaluation<'a> {
    /// The expression to evaluate.
    pub(crate) expression: &'a str,
    /// The context to evaluate it in.
    pub(crate) context_id: u64,
    /// Keeps the result as a remote object of this group instead of returning its value.
    pub(crate) group: Option<&'a str>,
}

/// One `DevTools` session.
pub(crate) struct Session {
    socket: WebSocketStream<MaybeTlsStream<TcpStream>>,
    next_id: u64,
    queued: VecDeque<Event>,
    contexts: Vec<ExecutionContext>,
    reply_timeout: Duration,
}

impl Session {
    /// Connects to a target's WebSocket debugger URL.
    pub(crate) async fn open(url: &str) -> Result<Self> {
        let (socket, _response) = timeout(CONNECT_TIMEOUT, connect_async(url))
            .await
            .map_err(|_| CdpError::Timeout("the WebSocket handshake"))??;
        Ok(Self {
            socket,
            next_id: 1,
            queued: VecDeque::new(),
            contexts: Vec::new(),
            reply_timeout: DEFAULT_REPLY_TIMEOUT,
        })
    }

    /// Waits at most `reply_timeout` for each reply.
    pub(crate) const fn with_reply_timeout(mut self, reply_timeout: Duration) -> Self {
        self.reply_timeout = reply_timeout;
        self
    }

    /// Ends the session.
    pub(crate) async fn close(mut self) {
        self.socket.close(None).await.ok();
    }

    /// Sends a command and returns its `result`; events that arrive meanwhile are queued.
    pub(crate) async fn call<P: Serialize + Sync>(
        &mut self,
        method: Method,
        params: &P,
    ) -> Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let payload = encode_command(id, method, params)?;
        self.socket.send(Message::text(payload)).await?;
        timeout(self.reply_timeout, self.reply_to(id, method))
            .await
            .map_err(|_| CdpError::Timeout("a CDP reply"))?
    }

    async fn reply_to(&mut self, id: u64, method: Method) -> Result<Value> {
        loop {
            let frame = self.read_frame().await?;
            if frame.id == Some(id) {
                if let Some(error) = frame.error {
                    let ErrorBody { message } = serde_json::from_value(error)?;
                    return Err(CdpError::Protocol(format!("{method:?}: {message}")));
                }
                return Ok(frame.result.unwrap_or(Value::Null));
            }
            let event = self.absorb(frame);
            self.queued.extend(event);
        }
    }

    /// Parses an event frame; the session keeps the execution contexts it sees and hands out the rest.
    fn absorb(&mut self, frame: Incoming) -> Option<Event> {
        let event = frame
            .method
            .and_then(|name| Event::parse(&name, frame.params))?;
        let Event::ExecutionContextCreated(context) = event else {
            return Some(event);
        };
        self.contexts.push(context);
        None
    }

    /// The execution contexts announced so far (`Runtime.enable` replays the existing ones).
    pub(crate) fn execution_contexts(&self) -> &[ExecutionContext] {
        &self.contexts
    }

    async fn read_frame(&mut self) -> Result<Incoming> {
        while let Some(message) = self.socket.next().await {
            if let Message::Text(text) = message? {
                return Ok(serde_json::from_str(text.as_str())?);
            }
        }
        Err(CdpError::Closed)
    }

    /// The next event worth printing, or none once the target closed the session.
    pub(crate) async fn next_event(&mut self) -> Result<Option<Event>> {
        if let Some(event) = self.queued.pop_front() {
            return Ok(Some(event));
        }
        loop {
            let frame = match self.read_frame().await {
                Ok(frame) => frame,
                Err(CdpError::Closed) => return Ok(None),
                Err(error) => return Err(error),
            };
            let event = self.absorb(frame);
            if event.is_some() {
                return Ok(event);
            }
        }
    }

    /// `Runtime.evaluate` (awaiting a promise, by value), returning the raw `result` object.
    pub(crate) async fn evaluate_raw(&mut self, expression: &str) -> Result<Value> {
        let params = EvaluateParams::awaited(expression);
        self.call(Method::RuntimeEvaluate, &params).await
    }

    /// `Runtime.evaluate` in one context, by value or as a remote object in an object group.
    pub(crate) async fn evaluate_in(
        &mut self,
        request: ContextEvaluation<'_>,
    ) -> Result<EvaluateReply> {
        let params =
            EvaluateParams::in_context(request.expression, request.context_id, request.group);
        let reply = self.call(Method::RuntimeEvaluate, &params).await?;
        Ok(serde_json::from_value(reply)?)
    }

    /// `Runtime.evaluate`, with the value and the exception split apart.
    pub(crate) async fn evaluate(&mut self, expression: &str) -> Result<Evaluation> {
        let reply: EvaluateReply = serde_json::from_value(self.evaluate_raw(expression).await?)?;
        Ok(Evaluation {
            value: reply.result.value.unwrap_or(Value::Null),
            exception: reply.exception_details.map(ExceptionDetails::message),
        })
    }
}

/// Evaluates one expression in a target over a session of its own.
pub(crate) async fn evaluate_on(target: &CdpTarget, expression: &str) -> Result<Evaluation> {
    let mut session = open_target(target).await?;
    let outcome = session.evaluate(expression).await;
    session.close().await;
    outcome
}
