//! The waiting and polling steps of one verified download.

use std::collections::HashSet;
use std::time::Duration;

use serde_json::json;
use tokio::time::{sleep, Instant};

use super::browser::{Browser, Wanted};
use super::page::{
    click_download, read_button_label, read_playability, search_downloads, DownloadItem,
    DownloadState,
};

const MAX_RELOADS: u32 = 15;
const PLAYABLE_WINDOW: Duration = Duration::from_secs(12);
const PLAYABLE_POLL: Duration = Duration::from_millis(750);
const RELOAD_SETTLE: Duration = Duration::from_secs(3);
const BUTTON_WINDOW: Duration = Duration::from_secs(90);
const BUTTON_POLL: Duration = Duration::from_millis(500);
const DOWNLOAD_POLL: Duration = Duration::from_millis(500);

/// Why a verification did not end in a completed download.
#[derive(Debug)]
pub(crate) struct Failure {
    pub(crate) reason: String,
    pub(crate) item: Option<Box<DownloadItem>>,
    /// Whether the failure came after the click, so the duration is worth reporting.
    pub(crate) is_timed: bool,
}

impl Failure {
    pub(crate) fn because(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
            item: None,
            is_timed: false,
        }
    }
}

async fn playable_within_window(browser: &Browser) -> bool {
    let deadline = Instant::now() + PLAYABLE_WINDOW;
    while Instant::now() < deadline {
        let Some(playability) = read_playability(browser).await else {
            sleep(PLAYABLE_POLL).await;
            continue;
        };
        if playability.is_playable() {
            return true;
        }
        if playability.is_refused() {
            return false;
        }
        sleep(PLAYABLE_POLL).await;
    }
    false
}

/// Reloads the watch tab until the player reports the video as playable.
pub(crate) async fn wait_for_playable(browser: &Browser) -> Result<(), Failure> {
    for attempt in 0..=MAX_RELOADS {
        if playable_within_window(browser).await {
            return Ok(());
        }
        let last = read_playability(browser).await;
        let status = last
            .as_ref()
            .and_then(|playability| playability.status.clone());
        let reason = last.and_then(|playability| playability.reason);
        if attempt == MAX_RELOADS {
            return Err(Failure::because(format!(
                "unplayable after {} attempts: {} / {}",
                MAX_RELOADS + 1,
                status.as_deref().unwrap_or("?"),
                reason.as_deref().unwrap_or_default()
            )));
        }
        eprintln!(
            "{}",
            json!({ "note": "unplayable, reloading", "attempt": attempt, "status": status, "reason": reason })
        );
        browser.reload_watch_tab().await;
        sleep(RELOAD_SETTLE).await;
    }
    Err(Failure::because("unplayable loop exited"))
}

/// Waits for the extension's Download button to mount, then clicks it.
pub(crate) async fn click_when_mounted(browser: &Browser) -> Result<(), Failure> {
    let deadline = Instant::now() + BUTTON_WINDOW;
    while Instant::now() < deadline {
        if read_button_label(browser).await.is_some() {
            return click(browser).await;
        }
        sleep(BUTTON_POLL).await;
    }
    Err(Failure::because("extension Download button never mounted"))
}

async fn click(browser: &Browser) -> Result<(), Failure> {
    let Some(outcome) = click_download(browser).await else {
        return Err(Failure::because("click failed"));
    };
    if outcome.ok {
        return Ok(());
    }
    Err(Failure::because(
        outcome.reason.unwrap_or_else(|| "click failed".to_owned()),
    ))
}

fn fresh_items(items: Option<Vec<DownloadItem>>, before: &HashSet<u64>) -> Vec<DownloadItem> {
    items
        .unwrap_or_default()
        .into_iter()
        .filter(|item| !before.contains(&item.id))
        .collect()
}

fn verdict(items: Vec<DownloadItem>) -> Option<Result<DownloadItem, Failure>> {
    items.into_iter().find_map(|item| match item.state {
        DownloadState::Complete => Some(Ok(item)),
        DownloadState::Interrupted => Some(Err(Failure {
            reason: format!(
                "download interrupted: {}",
                item.error.as_deref().unwrap_or("?")
            ),
            item: Some(Box::new(item)),
            is_timed: true,
        })),
        DownloadState::InProgress => None,
    })
}

/// Polls until a download that was not there before completes, is interrupted, or time runs out.
pub(crate) async fn poll_for_completion(
    browser: &Browser,
    before: &HashSet<u64>,
    deadline: Instant,
) -> Result<DownloadItem, Failure> {
    while Instant::now() < deadline {
        if let Some(done) = verdict(fresh_items(search_downloads(browser).await, before)) {
            return done;
        }
        sleep(DOWNLOAD_POLL).await;
    }
    let completed = fresh_items(search_downloads(browser).await, before)
        .into_iter()
        .find(|item| item.state == DownloadState::Complete);
    completed.ok_or_else(|| Failure {
        is_timed: true,
        ..Failure::because("timeout waiting for new download to complete")
    })
}

/// Confirms the watch tab and the extension worker both exist.
pub(crate) async fn require_targets(browser: &Browser) -> Result<(), Failure> {
    let tab = browser.fresh(Wanted::WatchTab).await.ok().flatten();
    if tab.is_none() {
        return Err(Failure::because("no YT watch tab open"));
    }
    let worker = browser.fresh(Wanted::ServiceWorker).await.ok().flatten();
    if worker.is_none() {
        return Err(Failure::because("no extension SW target"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: u64, state: DownloadState) -> DownloadItem {
        DownloadItem {
            id,
            filename: format!("{id}.mp4"),
            state,
            start_time: None,
            end_time: None,
            bytes_received: None,
            total_bytes: None,
            error: Some("NETWORK_FAILED".to_owned()),
        }
    }

    #[test]
    fn only_items_absent_before_count() {
        let before = HashSet::from([1]);
        let fresh = fresh_items(
            Some(vec![
                item(1, DownloadState::Complete),
                item(2, DownloadState::InProgress),
            ]),
            &before,
        );
        assert_eq!(fresh.len(), 1);
        assert_eq!(fresh.first().map(|found| found.id), Some(2));
    }

    #[test]
    fn verdict_reports_completion_and_interruption() {
        assert!(verdict(vec![item(1, DownloadState::InProgress)]).is_none());
        assert!(matches!(
            verdict(vec![item(1, DownloadState::Complete)]),
            Some(Ok(_))
        ));
        let Some(Err(failure)) = verdict(vec![item(1, DownloadState::Interrupted)]) else {
            panic!("expected a failure");
        };
        assert_eq!(failure.reason, "download interrupted: NETWORK_FAILED");
    }
}
