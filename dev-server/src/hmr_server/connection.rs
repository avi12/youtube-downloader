//! The accept loop and one client's life: handshake, initial sync, pushes, pings and pongs.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast::{self, error::RecvError};
use tokio::task::JoinSet;
use tokio::time::{interval_at, timeout, Instant, MissedTickBehavior};
use tokio_tungstenite::tungstenite::error::{Error as WebSocketError, ProtocolError};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, WebSocketStream};
use tokio_util::sync::CancellationToken;

use crate::error::{Error, Result};
use crate::hmr_server::push::PushKind;
use crate::hmr_server::{manifest_payload, HmrHandle};

/// How long a client may take to finish the WebSocket handshake.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
/// How long a client may take to accept one message before it is treated as dead.
const SEND_TIMEOUT: Duration = Duration::from_secs(5);
/// Pause after a failed accept, so a persistent error cannot spin the loop.
const ACCEPT_RETRY_DELAY: Duration = Duration::from_millis(100);
/// Connections beyond this many are dropped; the runtime holds one socket per install generation.
const MAX_CLIENTS: usize = 64;

type Socket = WebSocketStream<TcpStream>;

/// What the injected runtime may send; anything else is ignored.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMessage {
    Pong,
}

/// What every client task shares.
#[derive(Debug, Clone)]
pub(super) struct ClientContext {
    pub(super) handle: HmrHandle,
    pub(super) output_dir: Arc<Path>,
    pub(super) ping_interval: Duration,
}

/// Accepts clients until `shutdown`, then waits for every client task to end.
pub(super) async fn accept_loop(
    listener: TcpListener,
    context: ClientContext,
    shutdown: CancellationToken,
) {
    let mut clients = JoinSet::new();
    loop {
        tokio::select! {
            () = shutdown.cancelled() => break,
            Some(_) = clients.join_next(), if !clients.is_empty() => {}
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) if context.handle.client_count() < MAX_CLIENTS => {
                    clients.spawn(serve_client(stream, context.clone(), shutdown.clone()));
                }
                Ok(_) => tracing::warn!("HMR client refused: too many connections"),
                Err(error) => {
                    tracing::warn!("HMR accept failed: {error}");
                    tokio::time::sleep(ACCEPT_RETRY_DELAY).await;
                }
            },
        }
    }
    while clients.join_next().await.is_some() {}
}

async fn serve_client(stream: TcpStream, context: ClientContext, shutdown: CancellationToken) {
    let mut socket = match timeout(HANDSHAKE_TIMEOUT, accept_async(stream)).await {
        Ok(Ok(socket)) => socket,
        Ok(Err(error)) if is_closed_before_handshake(&error) => return,
        Ok(Err(error)) => return tracing::debug!("HMR handshake failed: {error}"),
        Err(_) => return tracing::debug!("HMR handshake timed out"),
    };
    let mut updates = context.handle.subscribe();
    if let Err(error) = converse(&mut socket, &mut updates, &context, &shutdown).await {
        return tracing::debug!("HMR client dropped: {error}");
    }
    let _ = timeout(SEND_TIMEOUT, socket.close(None)).await;
}

/// A peer that connected and hung up without sending a request: a port probe or a browser's
/// speculative preconnect, never an HMR runtime, so there is nothing to report.
const fn is_closed_before_handshake(error: &WebSocketError) -> bool {
    matches!(
        error,
        WebSocketError::Protocol(ProtocolError::HandshakeIncomplete)
            | WebSocketError::ConnectionClosed
    )
}

async fn send_text(socket: &mut Socket, text: &str) -> Result<()> {
    timeout(SEND_TIMEOUT, socket.send(Message::text(text)))
        .await
        .map_err(|_| Error::Timeout("a client to accept a message"))??;
    Ok(())
}

async fn initial_sync(socket: &mut Socket, context: &ClientContext) -> Result<()> {
    let output_dir = Arc::clone(&context.output_dir);
    let payload = tokio::task::spawn_blocking(move || manifest_payload(&output_dir))
        .await
        .map_err(std::io::Error::other)??;
    let Some(payload) = payload else {
        return Ok(());
    };
    send_text(socket, &payload).await?;
    context.handle.stamp_import_push();
    Ok(())
}

/// One client's life: initial sync, then pushes, pings and pongs until it closes, stops answering,
/// lags or the server shuts down. An `Err` means the socket is dead: it is dropped without a close
/// handshake, which is what the next injection reads as a takeover signal.
async fn converse(
    socket: &mut Socket,
    updates: &mut broadcast::Receiver<Arc<str>>,
    context: &ClientContext,
    shutdown: &CancellationToken,
) -> Result<()> {
    initial_sync(socket, context).await?;
    let mut ping = interval_at(
        Instant::now() + context.ping_interval,
        context.ping_interval,
    );
    ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut is_pong_pending = false;
    loop {
        tokio::select! {
            () = shutdown.cancelled() => return Ok(()),
            update = updates.recv() => match update {
                Ok(payload) => send_text(socket, &payload).await?,
                Err(RecvError::Lagged(_) | RecvError::Closed) => return Ok(()),
            },
            _ = ping.tick() => {
                if is_pong_pending {
                    return Err(Error::Timeout("a pong"));
                }
                is_pong_pending = true;
                send_text(socket, &PushKind::Ping.bare_payload()).await?;
            }
            incoming = socket.next() => match incoming {
                None | Some(Ok(Message::Close(_))) => return Ok(()),
                Some(Err(error)) => return Err(error.into()),
                Some(Ok(Message::Text(text))) => {
                    let message = serde_json::from_str::<ClientMessage>(text.as_str());
                    is_pong_pending &= message.is_err();
                }
                Some(Ok(_)) => {}
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use std::net::Ipv4Addr;

    use tokio::io::AsyncWriteExt;
    use tokio::sync::mpsc;
    use tracing_subscriber::layer::SubscriberExt;

    use super::*;
    use crate::bridge::logging::BridgeLogLayer;
    use crate::bridge::protocol::{LogLine, OutboundMessage};
    use crate::hmr_server::serve_listener_pinging;

    const WAIT: Duration = Duration::from_secs(5);
    const QUIET: Duration = Duration::from_millis(100);

    #[tokio::test]
    async fn a_connection_closed_before_the_handshake_logs_nothing() -> Result<()> {
        let (sender, mut logs) = mpsc::channel(8);
        let _guard = tracing::subscriber::set_default(
            tracing_subscriber::registry().with(BridgeLogLayer::new(sender)),
        );
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let address = listener.local_addr()?;
        let shutdown = CancellationToken::new();
        let _handle = serve_listener_pinging(listener, Path::new("."), shutdown.clone(), WAIT);

        drop(TcpStream::connect(address).await?);
        let mut not_websocket = TcpStream::connect(address).await?;
        not_websocket
            .write_all(b"GET / HTTP/1.1\r\nHost: x\r\n\r\n")
            .await?;
        let first = timeout(WAIT, logs.recv()).await;
        tokio::time::sleep(QUIET).await;
        shutdown.cancel();
        assert!(logs.try_recv().is_err(), "only the malformed request logs");

        let Ok(Some(OutboundMessage::Log(LogLine { log }))) = first else {
            panic!("expected the malformed request to be logged");
        };
        assert!(
            log.starts_with("HMR handshake failed"),
            "the probe that hung up stayed silent, got {log}"
        );
        assert!(!log.contains("Handshake not finished"));
        Ok(())
    }
}
