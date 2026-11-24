//! The browser reload seam: what the orchestrator needs from a browser, whichever protocol
//! ([`crate::driver::cdp`] or [`crate::driver::rdp`]) carries it. The orchestrator is generic over this trait, so
//! its tests drive a fake and wave-2 modules never need a live browser.

pub mod cdp;
mod net;
pub mod rdp;

use std::future::Future;

use crate::bridge::protocol::SidecarConfig;
use crate::driver::cdp::CdpClient;
use crate::driver::rdp::RdpClient;
use crate::error::{Error, Result};
use crate::types::BrowserKind;

/// The path suffix of an entrypoint's HTML page, by which both protocols find its open pages.
fn entrypoint_page(entrypoint: &str) -> String {
    format!("/{entrypoint}.html")
}

/// Reload operations on a running browser.
pub trait BrowserDriver: Send + Sync {
    /// Reloads every open `YouTube` tab; returns how many were reloaded.
    /// Replaces `reloadYouTubeTabsOverCdp` (the replaced TypeScript dev server) and the Firefox tab reload of `scripts/dev/browsers/firefox/target.ts`.
    fn reload_youtube_tabs(&self) -> impl Future<Output = Result<usize>> + Send;

    /// Reloads the open pages of one HTML entrypoint (popup, grant, iframed pages) in place; true
    /// when at least one page was reloaded.
    /// Replaces `reloadOpenExtensionPages` (the replaced TypeScript dev server) and `reloadExtensionPagesFirefox` (`scripts/dev/browsers/firefox/`).
    fn reload_extension_pages(&self, entrypoint: &str)
        -> impl Future<Output = Result<bool>> + Send;

    /// Whether the browser still answers; false once it is gone.
    /// Replaces the `isBrowserAlive` probes of the browser targets.
    fn is_alive(&self) -> impl Future<Output = bool> + Send;
}

/// The driver of whichever browser family the config names: CDP for Chromium, RDP for Firefox.
/// An enum rather than a trait object, because [`BrowserDriver`] returns `impl Future`.
#[derive(Debug)]
#[non_exhaustive]
pub enum Driver {
    /// Chrome, Edge, Opera.
    Cdp(CdpClient),
    /// Firefox.
    Rdp(RdpClient),
}

impl Driver {
    /// The driver for `config.browser`; Firefox needs the extension id and its internal UUID.
    pub fn from_config(config: &SidecarConfig) -> Result<Self> {
        match config.browser {
            BrowserKind::Firefox => {
                let (Some(id), Some(uuid)) = (&config.extension_id, &config.extension_uuid) else {
                    return Err(Error::Protocol(
                        "Firefox needs extensionId and extensionUuid in the config".to_owned(),
                    ));
                };
                Ok(Self::Rdp(RdpClient::new(
                    config.debug_port,
                    id.clone(),
                    uuid.clone(),
                )))
            }
            _ => Ok(Self::Cdp(CdpClient::new(config.debug_port))),
        }
    }
}

impl BrowserDriver for Driver {
    async fn reload_youtube_tabs(&self) -> Result<usize> {
        match self {
            Self::Cdp(client) => client.reload_youtube_tabs().await,
            Self::Rdp(client) => client.reload_youtube_tabs().await,
        }
    }

    async fn reload_extension_pages(&self, entrypoint: &str) -> Result<bool> {
        match self {
            Self::Cdp(client) => client.reload_extension_pages(entrypoint).await,
            Self::Rdp(client) => client.reload_extension_pages(entrypoint).await,
        }
    }

    async fn is_alive(&self) -> bool {
        match self {
            Self::Cdp(client) => client.is_alive().await,
            Self::Rdp(client) => client.is_alive().await,
        }
    }
}
