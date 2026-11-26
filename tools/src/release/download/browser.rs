//! Looking targets up on a debug port, with the retries the verification needs.

use std::time::Duration;

use serde::de::DeserializeOwned;
use tokio::time::sleep;
use ytdl_dev_hot::driver::cdp::{CdpClient, CdpTarget, TargetKind};
use ytdl_dev_hot::types::Port;

use crate::cdp::wire::{evaluate_on, open_target, CdpError, Method, ReloadParams};
use crate::release::ReleaseError;

const WATCH_URL_PART: &str = "youtube.com/watch";
const EXTENSION_ID: &str = "iakmamcpgldfjjbeamagdkelogmokjpj";
const TARGET_ATTEMPTS: u32 = 10;
const TARGET_RETRY_DELAY: Duration = Duration::from_secs(1);
const EVALUATE_ATTEMPTS: u32 = 4;
const RELOAD_ATTEMPTS: u32 = 3;
const FAILURE_RETRY_DELAY: Duration = Duration::from_millis(1500);

/// Which kind of target to look for.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Wanted {
    /// A `YouTube` watch tab.
    WatchTab,
    /// The extension's service worker.
    ServiceWorker,
}

impl Wanted {
    fn matches(self, target: &CdpTarget) -> bool {
        if target.debugger_url().is_none() {
            return false;
        }
        match self {
            Self::WatchTab => {
                target.kind == TargetKind::Page && target.url.contains(WATCH_URL_PART)
            }
            Self::ServiceWorker => {
                target.kind == TargetKind::ServiceWorker && target.url.contains(EXTENSION_ID)
            }
        }
    }
}

async fn evaluate_value<T: DeserializeOwned>(
    target: &CdpTarget,
    expression: &str,
) -> Result<T, CdpError> {
    let value = evaluate_on(target, expression).await?.into_value()?;
    Ok(serde_json::from_value(value)?)
}

async fn reload(target: &CdpTarget) -> Result<(), CdpError> {
    let mut session = open_target(target).await?;
    let outcome = session
        .call(Method::PageReload, &ReloadParams::KEEPING_CACHE)
        .await;
    session.close().await;
    outcome.map(drop)
}

/// A browser's debug port, with the lookups and retries of the verification.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Browser {
    client: CdpClient,
}

impl Browser {
    /// A browser listening on `port`.
    pub(crate) const fn new(port: Port) -> Self {
        Self {
            client: CdpClient::new(port),
        }
    }

    /// The target, waiting up to ten seconds for it to appear.
    pub(crate) async fn fresh(&self, wanted: Wanted) -> Result<Option<CdpTarget>, ReleaseError> {
        for _ in 0..TARGET_ATTEMPTS {
            let targets = self.client.list_targets().await?;
            if let Some(found) = targets.into_iter().find(|target| wanted.matches(target)) {
                return Ok(Some(found));
            }
            sleep(TARGET_RETRY_DELAY).await;
        }
        Ok(None)
    }

    /// Evaluates `expression` in the target, retrying against a fresh target after a failure;
    /// `None` when it never worked or the result has another shape.
    pub(crate) async fn evaluate<T: DeserializeOwned>(
        &self,
        wanted: Wanted,
        expression: &str,
    ) -> Option<T> {
        for _ in 0..EVALUATE_ATTEMPTS {
            let target = self.fresh(wanted).await.ok().flatten()?;
            if let Ok(value) = evaluate_value(&target, expression).await {
                return Some(value);
            }
            sleep(FAILURE_RETRY_DELAY).await;
        }
        None
    }

    /// Reloads the watch tab, retrying a few times.
    pub(crate) async fn reload_watch_tab(&self) {
        let Some(tab) = self.fresh(Wanted::WatchTab).await.ok().flatten() else {
            return;
        };
        for _ in 0..RELOAD_ATTEMPTS {
            if reload(&tab).await.is_ok() {
                return;
            }
            sleep(FAILURE_RETRY_DELAY).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn target(kind: TargetKind, url: &str, socket: Option<&str>) -> CdpTarget {
        serde_json::from_value(json!({
            "id": "t",
            "type": match kind {
                TargetKind::Page => "page",
                TargetKind::ServiceWorker => "service_worker",
                _ => "other",
            },
            "url": url,
            "webSocketDebuggerUrl": socket,
        }))
        .unwrap()
    }

    #[test]
    fn watch_tab_needs_a_page_on_a_watch_url_with_a_socket() {
        let socket = Some("ws://x");
        assert!(Wanted::WatchTab.matches(&target(
            TargetKind::Page,
            "https://www.youtube.com/watch?v=1",
            socket
        )));
        assert!(!Wanted::WatchTab.matches(&target(
            TargetKind::Page,
            "https://www.youtube.com/",
            socket
        )));
        assert!(!Wanted::WatchTab.matches(&target(
            TargetKind::Page,
            "https://www.youtube.com/watch?v=1",
            None
        )));
    }

    #[test]
    fn service_worker_is_matched_by_extension_id() {
        let url = format!("chrome-extension://{EXTENSION_ID}/background.js");
        assert!(Wanted::ServiceWorker.matches(&target(
            TargetKind::ServiceWorker,
            &url,
            Some("ws://x")
        )));
        assert!(!Wanted::ServiceWorker.matches(&target(TargetKind::Page, &url, Some("ws://x"))));
    }
}
