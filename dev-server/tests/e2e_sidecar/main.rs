//! End to end: the real `ytdl-dev-hot` binary against a temporary project, a fake TypeScript peer
//! speaking the JSON-lines bridge on its stdio, a fake CDP browser and a real HMR WebSocket client.
//!
//! The peer answers every request like the launcher would (the build optionally rewrites output
//! files), so each test asserts on what the sidecar asked for and what it pushed. Time is real but
//! bounded: tests poll with `eventually` and never sleep for a fixed duration.

mod browser;
mod hmr_client;
mod project;
mod scenarios;
mod sidecar;

use std::time::Duration;

use tokio::time::{sleep, timeout};

pub(crate) const POLL_STEP: Duration = Duration::from_millis(25);
pub(crate) const WAIT: Duration = Duration::from_secs(25);
pub(crate) const FILE_POLL_MS: u64 = 40;
pub(crate) const DEBOUNCE_MS: u64 = 60;

pub(crate) async fn eventually<T>(what: &str, mut probe: impl FnMut() -> Option<T>) -> T {
    let outcome = timeout(WAIT, async {
        loop {
            if let Some(found) = probe() {
                return found;
            }
            sleep(POLL_STEP).await;
        }
    })
    .await;
    outcome.unwrap_or_else(|_| panic!("timed out waiting for {what}"))
}
