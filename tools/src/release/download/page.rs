//! The page and service-worker queries of the verification, each one typed.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::release::download::browser::{Browser, Wanted};

/// Runs in the service worker.
const SEARCH_DOWNLOADS: &str = r"
new Promise(res => {
  chrome.downloads.search({ limit: 20, orderBy: ['-startTime'] }, items => {
    res(items.map(it => ({
      id: it.id, filename: it.filename, state: it.state,
      startTime: it.startTime, endTime: it.endTime,
      bytesReceived: it.bytesReceived, totalBytes: it.totalBytes,
      error: it.error
    })));
  });
})
";

/// Runs in the watch tab.
const READ_PLAYABILITY: &str = r"
(() => {
  const pr = window.ytInitialPlayerResponse?.playabilityStatus;
  const status = pr?.status ?? null;
  const reason = pr?.reason ?? pr?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText ?? null;
  const errorOverlay = !!document.querySelector('.ytp-error');
  return { status, reason, errorOverlay };
})()
";

/// Runs in the watch tab.
const READ_BUTTON_LABEL: &str = r"
(() => {
  const host = document.querySelector('.ytdl-download-button');
  if (!host) return null;
  const btn = host.querySelector('button') || (host.matches('button') ? host : null);
  if (!btn) return null;
  return (btn.getAttribute('aria-label') || btn.textContent || '').trim();
})()
";

/// Runs in the watch tab.
const CLICK_BUTTON: &str = r"
(() => {
  const host = document.querySelector('.ytdl-download-button');
  if (!host) return { ok: false, reason: 'no .ytdl-download-button' };
  const btn = host.querySelector('button') ?? (host.matches('button') ? host : null);
  if (!btn) return { ok: false, reason: 'no button inside .ytdl-download-button' };
  btn.click();
  return { ok: true };
})()
";

const PLAYABLE_STATUS: &str = "OK";

/// The state of a `chrome.downloads` item.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum DownloadState {
    /// Still downloading.
    InProgress,
    /// Stopped with an error.
    Interrupted,
    /// Finished.
    Complete,
}

/// One `chrome.downloads` item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadItem {
    pub(crate) id: u64,
    pub(crate) filename: String,
    pub(crate) state: DownloadState,
    pub(crate) start_time: Option<String>,
    pub(crate) end_time: Option<String>,
    pub(crate) bytes_received: Option<i64>,
    pub(crate) total_bytes: Option<i64>,
    pub(crate) error: Option<String>,
}

/// What the watch tab says about playback.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Playability {
    pub(crate) status: Option<String>,
    pub(crate) reason: Option<String>,
    #[serde(rename = "errorOverlay")]
    pub(crate) has_error_overlay: bool,
}

impl Playability {
    /// Whether the video plays.
    pub(crate) fn is_playable(&self) -> bool {
        self.status.as_deref() == Some(PLAYABLE_STATUS) && !self.has_error_overlay
    }

    /// Whether the player reported a definite refusal.
    pub(crate) fn is_refused(&self) -> bool {
        self.status
            .as_deref()
            .is_some_and(|status| status != PLAYABLE_STATUS)
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct ClickOutcome {
    #[serde(rename = "ok")]
    pub(crate) is_ok: bool,
    pub(crate) reason: Option<String>,
}

/// The twenty most recent downloads, newest first.
pub(crate) async fn search_downloads(browser: &Browser) -> Option<Vec<DownloadItem>> {
    browser
        .evaluate(Wanted::ServiceWorker, SEARCH_DOWNLOADS)
        .await
}

/// The ids of the most recent downloads.
pub(crate) async fn snapshot_download_ids(browser: &Browser) -> HashSet<u64> {
    search_downloads(browser)
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|item| item.id)
        .collect()
}

pub(crate) async fn read_playability(browser: &Browser) -> Option<Playability> {
    browser.evaluate(Wanted::WatchTab, READ_PLAYABILITY).await
}

/// The label of the extension's Download button, absent while it is not mounted.
pub(crate) async fn read_button_label(browser: &Browser) -> Option<String> {
    let label: Option<String> = browser
        .evaluate(Wanted::WatchTab, READ_BUTTON_LABEL)
        .await?;
    label.filter(|text| !text.is_empty())
}

pub(crate) async fn click_download(browser: &Browser) -> Option<ClickOutcome> {
    browser.evaluate(Wanted::WatchTab, CLICK_BUTTON).await
}

#[cfg(test)]
mod tests {
    use crate::release::download::page::*;

    #[test]
    fn playable_needs_ok_status_and_no_error_overlay() {
        let playable = |status: Option<&str>, has_error_overlay| Playability {
            status: status.map(str::to_owned),
            reason: None,
            has_error_overlay,
        };
        assert!(playable(Some("OK"), false).is_playable());
        assert!(!playable(Some("OK"), true).is_playable());
        assert!(playable(Some("UNPLAYABLE"), false).is_refused());
        assert!(!playable(None, false).is_refused());
    }

    #[test]
    fn download_items_parse_from_the_worker_reply() {
        let item: DownloadItem = serde_json::from_str(
            r#"{"id":4,"filename":"a.mp4","state":"in_progress","bytesReceived":10,"totalBytes":-1}"#,
        )
        .unwrap();
        assert_eq!(item.state, DownloadState::InProgress);
        assert_eq!(item.total_bytes, Some(-1));
    }
}
