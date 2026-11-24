//! Chrome `DevTools` Protocol client for Chromium browsers (Chrome, Edge, Opera).
//!
//! Replaces, in the TypeScript dev server it replaced: `fetchCdpTargets` (`GET /json/list` on the
//! debug port), `evaluateOverCdp` (one WebSocket per call, `Runtime.evaluate`, wait for the
//! reply), `findYouTubeTabTargets`, `collectFrames`, `reloadExtensionFrameInTab`
//! (`Page.getFrameTree`, find the frame by entrypoint name, `Page.navigate` it in place),
//! `reloadOpenExtensionPages`, `reloadYouTubeTabsOverCdp` (`location.reload()` in every `YouTube` tab,
//! concurrently), and the Chromium `isBrowserAlive` probe.
//!
//! Not here: HMR runtime injection (`injectHmrRuntime`, `scripts/dev/browsers/chrome/target.ts`) stays in TypeScript and
//! is reached through the bridge's `injectHmr`.
//!
//! Notes for the port: the TypeScript asks `/json`, this asks `/json/list` (the same list). The
//! HTTP request is a plain HTTP/1.1 GET over `tokio::net::TcpStream` (no HTTP client crate); the
//! WebSocket reuses `tokio-tungstenite`; every wait is bounded with `tokio::time::timeout` and maps
//! to [`Error::Timeout`](crate::Error::Timeout); reloads fan out with `JoinSet`, one reload per distinct target id.
//!
//! Deliberate differences from the TypeScript: a failing `/json/list` is an error (the TypeScript
//! swallowed it into an empty list) and the orchestrator decides what to do; per-target failures
//! stay tolerated (a closed or vanished tab never fails the batch); `evaluate` asks for
//! `awaitPromise` and `returnByValue` and reports `exceptionDetails` as an error; liveness is a
//! `GET /json/version` instead of a `/json` fetch.

mod frames;
mod http;
mod session;
mod target;

use std::collections::BTreeMap;
use std::future::Future;

use tokio::task::JoinSet;

use self::http::Endpoint;
use self::session::{is_closed, Session};
pub use self::target::{is_youtube_tab, CdpTarget, TargetId, TargetKind};
use crate::driver::{entrypoint_page, BrowserDriver};
use crate::error::Result;
use crate::types::Port;

const RELOAD_EXPRESSION: &str = "location.reload()";

/// A CDP client for one browser's debug port.
#[derive(Debug, Clone, Copy)]
pub struct CdpClient {
    port: Port,
}

impl CdpClient {
    /// A client for the browser listening on `port`.
    pub const fn new(port: Port) -> Self {
        Self { port }
    }

    /// All targets of the browser (`/json/list`).
    pub async fn list_targets(&self) -> Result<Vec<CdpTarget>> {
        Ok(serde_json::from_str(
            &http::get(self.port, Endpoint::List).await?,
        )?)
    }
}

/// Logs a failed per-target `action` and counts it as not done: a closed or vanished tab never
/// fails the batch.
fn settle(target: &CdpTarget, action: &str, outcome: Result<bool>) -> bool {
    outcome.unwrap_or_else(|error| {
        tracing::debug!(target = %target.id, %error, "{action} skipped");
        false
    })
}

/// Reloads one tab in place. A target that closes mid-reload still counts: `location.reload()`
/// tears the session down, and a vanished tab is tolerated, as in the TypeScript.
async fn reload_target(target: CdpTarget) -> bool {
    let Some(url) = target.debugger_url() else {
        return false;
    };
    let outcome = match Session::evaluate(url, RELOAD_EXPRESSION).await {
        Ok(()) => Ok(true),
        Err(error) if is_closed(&error) => Ok(true),
        Err(error) => Err(error),
    };
    settle(&target, "CDP reload", outcome)
}

/// Navigates the frame of `needle` inside one tab in place.
async fn navigate_frame_target(target: CdpTarget, needle: String) -> bool {
    let Some(url) = target.debugger_url() else {
        return false;
    };
    let outcome = Session::navigate_frame(url, &needle).await;
    settle(&target, "CDP frame reload", outcome)
}

/// Runs `job` once per distinct target, concurrently; counts the jobs that returned true.
async fn fan_out<Job, Fut>(targets: Vec<CdpTarget>, job: Job) -> usize
where
    Job: Fn(CdpTarget) -> Fut,
    Fut: Future<Output = bool> + Send + 'static,
{
    let distinct: BTreeMap<TargetId, CdpTarget> = targets
        .into_iter()
        .map(|target| (target.id.clone(), target))
        .collect();
    let mut jobs = JoinSet::new();
    for target in distinct.into_values() {
        jobs.spawn(job(target));
    }
    let mut succeeded = 0;
    while let Some(joined) = jobs.join_next().await {
        if joined.unwrap_or(false) {
            succeeded += 1;
        }
    }
    succeeded
}

impl BrowserDriver for CdpClient {
    async fn reload_youtube_tabs(&self) -> Result<usize> {
        let tabs = self
            .list_targets()
            .await?
            .into_iter()
            .filter(is_youtube_tab)
            .collect();
        Ok(fan_out(tabs, reload_target).await)
    }

    async fn reload_extension_pages(&self, entrypoint: &str) -> Result<bool> {
        let needle = entrypoint_page(entrypoint);
        let (pages, others): (Vec<_>, Vec<_>) = self
            .list_targets()
            .await?
            .into_iter()
            .partition(|target| target.is_open_at(&needle));
        if !pages.is_empty() {
            return Ok(fan_out(pages, reload_target).await > 0);
        }
        let tabs = others.into_iter().filter(is_youtube_tab).collect();
        let navigated = fan_out(tabs, |target| navigate_frame_target(target, needle.clone())).await;
        Ok(navigated > 0)
    }

    async fn is_alive(&self) -> bool {
        http::get(self.port, Endpoint::Version).await.is_ok()
    }
}
