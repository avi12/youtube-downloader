//! The two pump tasks behind [`connect`]: stdin lines to responses and notifications, the
//! outbound queue to stdout.

#[cfg(test)]
mod tests;

use std::sync::Arc;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

use crate::bridge::client::{BridgeClient, Correlator};
use crate::bridge::protocol::{
    decode_line, encode_line, InboundMessage, Notification, OutboundMessage,
};
use crate::bridge::BRIDGE_CHANNEL_CAPACITY;
use crate::error::{Error, Result};

/// A connected bridge.
#[derive(Debug)]
pub struct BridgeLink {
    /// Calls into the host.
    pub client: BridgeClient,
    /// One-way messages from the host.
    pub notifications: mpsc::Receiver<Notification>,
    /// The pump tasks' join handle; resolves once both ended.
    pub pump: JoinHandle<Result<()>>,
}

/// Starts the reader and writer pump tasks over `reader` (stdin after the config line) and `writer`
/// (stdout). Must be called inside a tokio runtime. A `{"notify":"shutdown"}` line cancels
/// `shutdown`; cancelling it from outside makes the pump flush queued lines and end.
pub fn connect<R, W>(reader: R, writer: W, shutdown: CancellationToken) -> Result<BridgeLink>
where
    R: AsyncBufRead + Unpin + Send + 'static,
    W: AsyncWrite + Unpin + Send + 'static,
{
    let correlator = Arc::new(Correlator::default());
    let (outbound, queue) = mpsc::channel(BRIDGE_CHANNEL_CAPACITY);
    let (notifier, notifications) = mpsc::channel(BRIDGE_CHANNEL_CAPACITY);
    let stop = shutdown.child_token();
    let inbound = Inbound {
        correlator: Arc::clone(&correlator),
        notifier,
        shutdown,
    };
    let reader_task = tokio::spawn(read_loop(reader, inbound, stop.clone()));
    let writer_task = tokio::spawn(write_loop(writer, queue, stop));
    let pump = tokio::spawn(async move {
        let (read_result, write_result) = tokio::join!(reader_task, writer_task);
        read_result.map_err(std::io::Error::other)??;
        write_result.map_err(std::io::Error::other)?
    });
    Ok(BridgeLink {
        client: BridgeClient::new(outbound, correlator),
        notifications,
        pump,
    })
}

struct Inbound {
    correlator: Arc<Correlator>,
    notifier: mpsc::Sender<Notification>,
    shutdown: CancellationToken,
}

impl Inbound {
    fn route(&self, line: &str) {
        if line.trim().is_empty() {
            return;
        }
        match decode_line::<InboundMessage>(line) {
            Ok(InboundMessage::Response(response)) => {
                if !self.correlator.resolve(response) {
                    tracing::debug!("bridge response with no waiting request");
                }
            }
            Ok(InboundMessage::Notification(notification)) => {
                if notification == Notification::Shutdown {
                    self.shutdown.cancel();
                }
                let _ = self.notifier.try_send(notification);
            }
            Err(error) => tracing::warn!("bridge line skipped: {error}"),
        }
    }
}

async fn read_loop<R>(reader: R, inbound: Inbound, stop: CancellationToken) -> Result<()>
where
    R: AsyncBufRead + Unpin,
{
    let _stops_writer = stop.clone().drop_guard();
    let mut lines = reader.lines();
    let outcome = loop {
        let next = tokio::select! {
            () = stop.cancelled() => break Ok(()),
            next = lines.next_line() => next,
        };
        match next {
            Ok(Some(line)) => inbound.route(&line),
            Ok(None) => break Ok(()),
            Err(error) => break Err(Error::from(error)),
        }
    };
    inbound.correlator.fail_all();
    outcome
}

async fn write_loop<W>(
    mut writer: W,
    mut queue: mpsc::Receiver<OutboundMessage>,
    stop: CancellationToken,
) -> Result<()>
where
    W: AsyncWrite + Unpin,
{
    let _stops_reader = stop.clone().drop_guard();
    loop {
        let next = tokio::select! {
            () = stop.cancelled() => break,
            next = queue.recv() => next,
        };
        let Some(message) = next else { break };
        write_message(&mut writer, &message).await?;
    }
    queue.close();
    while let Some(message) = queue.recv().await {
        write_message(&mut writer, &message).await?;
    }
    Ok(())
}

async fn write_message<W>(writer: &mut W, message: &OutboundMessage) -> Result<()>
where
    W: AsyncWrite + Unpin,
{
    writer.write_all(encode_line(message)?.as_bytes()).await?;
    writer.flush().await?;
    Ok(())
}
