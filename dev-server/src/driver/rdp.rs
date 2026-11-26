//! Firefox Remote Debugging Protocol client.
//!
//! Replaces the former Firefox HMR script (now `scripts/dev/browsers/firefox/`): `createRdpClient` (TCP connect with
//! `RDP_CONNECT_TIMEOUT_MS`, the `<len>:<json>` framing, request/reply matching with
//! `RDP_REPLY_TIMEOUT_MS`), the extension-page reload `reloadExtensionPagesFirefox`
//! (find the extension's pages through its background and reload the ones of one entrypoint), and
//! the Firefox tab reload (here through the background's `browser.tabs.reload`, because Firefox's
//! CDP `/json` answers 404) and the liveness probe of `scripts/dev/browsers/firefox/target.ts`. `findFirefoxRdpPort` is not
//! ported: the launcher passes the port in the config.
//!
//! Not here: HMR runtime injection (`injectHmrFirefox`) stays in TypeScript behind the bridge's
//! `injectHmr`.
//!
//! One connection serves one operation and is dropped afterwards. Packets nobody asked for yet wait
//! in a bounded queue, so a notification that arrives while another reply is awaited (the
//! background frame during a wake) is not lost. Every network await is bounded by a timeout.

mod background;
mod connection;
pub mod message;
mod packet;
mod timings;

use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio::time::timeout;

use self::connection::{Connection, Evaluation};
pub use self::packet::{encode_packet, PacketDecoder};
pub use self::timings::RdpTimings;
use crate::driver::net::loopback;
use crate::driver::{entrypoint_page, BrowserDriver};
use crate::error::Result;
use crate::types::Port;

const RELOAD_YOUTUBE_TABS_JS: &str = r#"(async () => {
  const tabs = await browser.tabs.query({ url: "*://*.youtube.com/*" });
  for (const tab of tabs) {
    await browser.tabs.reload(tab.id);
  }
  return tabs.length;
})()"#;

/// The background script that reloads every open view of the page ending in `suffix` and returns
/// how many it reloaded.
fn reload_views_js(suffix: &Value) -> String {
    format!(
        "(() => {{ let reloaded = 0; for (const view of browser.extension.getViews()) {{              if (view.location.pathname.endsWith({suffix})) {{ view.location.reload(); reloaded++; }} }}              return reloaded; }})()"
    )
}

/// An RDP client for Firefox's debugger server.
#[derive(Debug, Clone)]
pub struct RdpClient {
    port: Port,
    extension_id: String,
    extension_uuid: String,
    timings: RdpTimings,
}

impl RdpClient {
    /// A client for the debugger server on `port`, bound to one extension.
    pub const fn new(port: Port, extension_id: String, extension_uuid: String) -> Self {
        Self::with_timings(port, extension_id, extension_uuid, RdpTimings::DEFAULT)
    }

    /// Like [`RdpClient::new`] with explicit wait limits (tests use short ones).
    pub const fn with_timings(
        port: Port,
        extension_id: String,
        extension_uuid: String,
        timings: RdpTimings,
    ) -> Self {
        Self {
            port,
            extension_id,
            extension_uuid,
            timings,
        }
    }

    /// Evaluates `code` in the extension's background and returns its numeric result; `None` when
    /// the background is unreachable or the evaluation failed (the caller retries on its next tick).
    async fn count_in_background(&self, code: &str) -> Result<Option<usize>> {
        let mut connection = Connection::open(self.port, self.timings.connect).await?;
        let Some(console) = self.find_background_console(&mut connection).await? else {
            return Ok(None);
        };
        let evaluated = connection
            .evaluate(&console, code, Evaluation::Awaited, self.timings.reply)
            .await;
        let count = evaluated
            .ok()
            .and_then(|packet| packet.result)
            .as_ref()
            .and_then(Value::as_u64)
            .and_then(|number| usize::try_from(number).ok());
        Ok(count)
    }
}

impl BrowserDriver for RdpClient {
    async fn reload_youtube_tabs(&self) -> Result<usize> {
        let reloaded = self.count_in_background(RELOAD_YOUTUBE_TABS_JS).await?;
        Ok(reloaded.unwrap_or(0))
    }

    async fn reload_extension_pages(&self, entrypoint: &str) -> Result<bool> {
        let code = reload_views_js(&json!(entrypoint_page(entrypoint)));
        let reloaded = self.count_in_background(&code).await?;
        Ok(reloaded.unwrap_or(0) > 0)
    }

    async fn is_alive(&self) -> bool {
        let connected = timeout(self.timings.probe, TcpStream::connect(loopback(self.port))).await;
        matches!(connected, Ok(Ok(_)))
    }
}
