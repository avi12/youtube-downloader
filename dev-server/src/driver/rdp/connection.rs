//! One RDP connection: framing, request/reply correlation by actor, and a bounded queue of packets
//! nobody asked for yet.

use std::collections::VecDeque;
use std::time::Duration;

use serde_json::{json, Map, Value};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::Instant;

use crate::driver::net::{loopback, until, within};
use crate::driver::rdp::message::{ActorId, Packet, PacketKind, RequestKind};
use crate::driver::rdp::packet::{encode_packet, PacketDecoder};
use crate::error::{Error, Result};
use crate::types::Port;

const READ_CHUNK_BYTES: usize = 8192;
const MAX_QUEUED_PACKETS: usize = 512;

/// Whether an evaluation's promise is awaited before its result is reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Evaluation {
    /// The result is the settled value of the returned promise.
    Awaited,
    /// The result is whatever the code returns, unawaited.
    Immediate,
}

impl Evaluation {
    fn request(self, code: &str) -> Value {
        match self {
            Self::Awaited => json!({"text": code, "mapped": {"await": true}}),
            Self::Immediate => json!({"text": code}),
        }
    }
}

/// One RDP connection: framing, a bounded queue of packets nobody asked for yet, and deadlines.
#[derive(Debug)]
pub(super) struct Connection<S> {
    stream: S,
    decoder: PacketDecoder,
    queue: VecDeque<Packet>,
}

impl<S: AsyncRead + AsyncWrite + Unpin + Send> Connection<S> {
    fn new(stream: S) -> Self {
        Self {
            stream,
            decoder: PacketDecoder::default(),
            queue: VecDeque::new(),
        }
    }

    pub(super) async fn send(
        &mut self,
        to: &ActorId,
        kind: RequestKind,
        extra: Value,
        limit: Duration,
    ) -> Result<()> {
        let mut message = Map::new();
        message.insert("to".into(), json!(to));
        message.insert("type".into(), json!(kind));
        if let Value::Object(fields) = extra {
            message.extend(fields);
        }
        let bytes = encode_packet(&Value::Object(message))?;
        within(limit, "rdp write", self.stream.write_all(&bytes)).await
    }

    async fn fill(&mut self, deadline: Instant, what: &'static str) -> Result<()> {
        let mut chunk = [0_u8; READ_CHUNK_BYTES];
        let read = until(deadline, what, self.stream.read(&mut chunk)).await?;
        let bytes = chunk.get(..read).unwrap_or_default();
        if bytes.is_empty() {
            return Err(Error::Protocol("rdp socket closed".into()));
        }
        let decoded = self.decoder.push(bytes)?;
        for packet in decoded
            .into_iter()
            .filter_map(|value| serde_json::from_value(value).ok())
        {
            let is_queue_full = self.queue.len() >= MAX_QUEUED_PACKETS;
            if is_queue_full {
                self.queue.pop_front();
            }
            self.queue.push_back(packet);
        }
        Ok(())
    }

    pub(super) async fn wait_for(
        &mut self,
        limit: Duration,
        what: &'static str,
        matches: impl Fn(&Packet) -> bool + Send,
    ) -> Result<Packet> {
        let deadline = Instant::now() + limit;
        loop {
            let found = self.queue.iter().position(&matches);
            if let Some(packet) = found.and_then(|index| self.queue.remove(index)) {
                return Ok(packet);
            }
            self.fill(deadline, what).await?;
        }
    }

    pub(super) async fn request(
        &mut self,
        to: &ActorId,
        kind: RequestKind,
        extra: Value,
        limit: Duration,
    ) -> Result<Packet> {
        self.send(to, kind, extra, limit).await?;
        self.wait_for(limit, "rdp reply", |packet| packet.is_from(to))
            .await
    }

    /// `evaluateJSAsync` answers first with an acknowledgement carrying a `resultID`, then later
    /// with an `evaluationResult` for that id; only that pair is matched, so stale results of an
    /// earlier timed-out evaluation never leak in.
    pub(super) async fn evaluate(
        &mut self,
        console: &ActorId,
        code: &str,
        evaluation: Evaluation,
        limit: Duration,
    ) -> Result<Packet> {
        let request = evaluation.request(code);
        self.send(console, RequestKind::EvaluateJsAsync, request, limit)
            .await?;
        let ack = self
            .wait_for(limit, "rdp evaluation ack", |packet| {
                packet.is_from(console) && packet.kind.is_none() && packet.result_id.is_some()
            })
            .await?;
        self.wait_for(limit, "rdp evaluation result", |packet| {
            packet.is_from(console)
                && packet.is_kind(PacketKind::EvaluationResult)
                && packet.result_id == ack.result_id
        })
        .await
    }
}

impl Connection<TcpStream> {
    /// Connects to `port` and waits for the root actor's greeting, each step within `limit`.
    pub(super) async fn open(port: Port, limit: Duration) -> Result<Self> {
        let stream = within(limit, "rdp connect", TcpStream::connect(loopback(port))).await?;
        let mut connection = Self::new(stream);
        let root = ActorId::root();
        connection
            .wait_for(limit, "rdp root greeting", |packet| packet.is_from(&root))
            .await?;
        Ok(connection)
    }
}

#[cfg(test)]
mod tests;
