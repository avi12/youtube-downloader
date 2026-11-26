//! A TCP connection that speaks the `<length>:<json>` framing shared by RDP and Marionette.

use std::collections::VecDeque;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use ytdl_dev_hot::driver::rdp::{encode_packet, PacketDecoder};

use super::{FirefoxError, Result};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const READ_CHUNK_BYTES: usize = 8192;

/// A framed JSON connection to a Firefox debugging port on loopback.
#[derive(Debug)]
pub(super) struct Framed {
    stream: TcpStream,
    decoder: PacketDecoder,
    ready: VecDeque<Value>,
}

impl Framed {
    pub(super) async fn connect(port: u16) -> Result<Self> {
        let connecting = TcpStream::connect(("127.0.0.1", port));
        let stream = timeout(CONNECT_TIMEOUT, connecting)
            .await
            .map_err(|_| FirefoxError::Timeout(format!("connection to port {port}")))??;
        Ok(Self {
            stream,
            decoder: PacketDecoder::default(),
            ready: VecDeque::new(),
        })
    }

    pub(super) async fn send<T: Serialize + Sync>(&mut self, packet: &T) -> Result<()> {
        self.write(&encode_packet(packet)?).await
    }

    /// Writes an already framed packet.
    pub(super) async fn write(&mut self, bytes: &[u8]) -> Result<()> {
        self.stream.write_all(bytes).await?;
        Ok(())
    }

    /// The next whole packet; safe to cancel (a dropped read loses no bytes).
    pub(super) async fn recv(&mut self) -> Result<Value> {
        loop {
            if let Some(packet) = self.ready.pop_front() {
                return Ok(packet);
            }
            let mut chunk = [0_u8; READ_CHUNK_BYTES];
            let read = self.stream.read(&mut chunk).await?;
            let bytes = chunk.get(..read).unwrap_or_default();
            if bytes.is_empty() {
                return Err(FirefoxError::Failed("the socket closed".into()));
            }
            self.ready.extend(self.decoder.push(bytes)?);
        }
    }
}
