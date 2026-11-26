//! Which targets of the debug port the commands talk to.

use clap::Args;
use ytdl_dev_hot::driver::cdp::{CdpClient, CdpTarget, TargetKind};
use ytdl_dev_hot::types::Port;

use crate::port::parse_port_number;

use crate::cdp::wire::error::{CdpError, Result};
use crate::cdp::wire::session::Session;

/// The id of the extension under development.
pub(crate) const EXTENSION_ID: &str = "iakmamcpgldfjjbeamagdkelogmokjpj";

const DEFAULT_PORT: u16 = 9229;
const WATCH_URL: &str = "youtube.com/watch";
const OFFSCREEN_URL: &str = "offscreen.html";
const DOWNLOADS_URL: &str = "chrome://downloads";
const EXTENSIONS_URL_PREFIX: &str = "chrome://extensions/?id=";
const EXTENSION_ORIGIN: &str = "chrome-extension://";
const POPUP_PAGE: &str = "popup.html";

/// The browser's remote debugging port, as every command takes it.
#[derive(Debug, Clone, Copy, Args)]
pub(crate) struct PortArg {
    /// The browser's remote debugging port
    #[arg(default_value_t = DEFAULT_PORT, value_parser = parse_port_number)]
    pub(crate) port: u16,
}

impl PortArg {
    /// Every target of the browser.
    pub(crate) async fn targets(self) -> Result<Targets> {
        let client = CdpClient::new(Port::new(self.port)?);
        Ok(Targets(client.list_targets().await?))
    }
}

/// A kind of target the scripts look for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Wanted {
    /// A `YouTube` watch page.
    WatchTab,
    /// The extension's own service worker.
    ExtensionWorker,
    /// Any extension service worker.
    AnyExtensionWorker,
    /// The offscreen document.
    Offscreen,
    /// The `chrome://downloads` tab.
    DownloadsTab,
    /// The extension's details page in `chrome://extensions`.
    ExtensionsPage,
    /// The extension's popup page.
    Popup,
}

impl Wanted {
    fn matches(self, target: &CdpTarget) -> bool {
        let url = target.url.as_str();
        let is_page = target.kind == TargetKind::Page;
        let is_worker = target.kind == TargetKind::ServiceWorker;
        match self {
            Self::WatchTab => is_page && url.contains(WATCH_URL),
            Self::ExtensionWorker => is_worker && url.contains(EXTENSION_ID),
            Self::AnyExtensionWorker => is_worker && url.starts_with(EXTENSION_ORIGIN),
            Self::Offscreen => url.contains(OFFSCREEN_URL),
            Self::DownloadsTab => is_page && url.starts_with(DOWNLOADS_URL),
            Self::ExtensionsPage => {
                is_page && url.contains(&format!("{EXTENSIONS_URL_PREFIX}{EXTENSION_ID}"))
            }
            Self::Popup => is_page && url.contains(&format!("{EXTENSION_ID}/{POPUP_PAGE}")),
        }
    }
}

/// The targets one listing returned.
#[derive(Debug)]
pub(crate) struct Targets(Vec<CdpTarget>);

impl Targets {
    /// The first target of the wanted kind.
    pub(crate) fn find(&self, wanted: Wanted) -> Option<&CdpTarget> {
        self.0.iter().find(|target| wanted.matches(target))
    }

    /// Every target of the wanted kind.
    pub(crate) fn filter(&self, wanted: Wanted) -> impl Iterator<Item = &CdpTarget> {
        self.0.iter().filter(move |target| wanted.matches(target))
    }

    /// Every target, in the browser's order.
    pub(crate) fn all(&self) -> &[CdpTarget] {
        &self.0
    }
}

/// Opens a session on a target, which needs a debugger URL no other client holds.
pub(crate) async fn open_target(target: &CdpTarget) -> Result<Session> {
    let url = target
        .debugger_url()
        .ok_or_else(|| CdpError::Protocol(format!("{} has no debugger URL", target.id)))?;
    Session::open(url).await
}

#[cfg(test)]
mod tests {
    use ytdl_dev_hot::driver::cdp::TargetId;

    use crate::cdp::wire::targets::*;

    fn target(kind: TargetKind, url: &str) -> CdpTarget {
        CdpTarget {
            id: TargetId("t".into()),
            kind,
            url: url.into(),
            web_socket_debugger_url: None,
        }
    }

    #[test]
    fn finds_each_kind() {
        let watch = target(TargetKind::Page, "https://www.youtube.com/watch?v=x");
        let worker = target(
            TargetKind::ServiceWorker,
            &format!("chrome-extension://{EXTENSION_ID}/background.js"),
        );
        let downloads = target(TargetKind::Page, "chrome://downloads/");
        assert!(Wanted::WatchTab.matches(&watch));
        assert!(Wanted::ExtensionWorker.matches(&worker));
        assert!(Wanted::AnyExtensionWorker.matches(&worker));
        assert!(Wanted::DownloadsTab.matches(&downloads));
        assert!(!Wanted::WatchTab.matches(&downloads));
    }

    #[test]
    fn lists_only_matches() {
        let targets = Targets(vec![
            target(TargetKind::Page, "chrome://downloads/"),
            target(TargetKind::Page, "https://example.com"),
        ]);
        assert_eq!(targets.filter(Wanted::DownloadsTab).count(), 1);
        assert!(targets.find(Wanted::Offscreen).is_none());
    }
}
