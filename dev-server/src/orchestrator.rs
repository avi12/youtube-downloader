//! The main loop tying the modules together.
//!
//! Replaces the event-driven core of `runDevServer` in the TypeScript dev server it replaced: the
//! watcher callbacks and timers (`scheduleRebuild`, `debounceTimer`), `drainPendingRebuild` (the
//! `isRebuilding` re-entrancy guard and drain loop), `rebuildAndReload`, `hotSwapDashboard`,
//! `applyResourceUpdate` (copy to the output directory, locale overlay, resource versions, push),
//! `runReloadSequence` (wait out [`PUSH_SETTLE`], broadcast reload-imminent, reload, wait out
//! [`RELOAD_SETTLE`], push the manifest, re-inject), `scheduleStaticBundleCatchUp` and
//! `runStaticBundleCatchUp`, the `keepHmrInjected` retry loop, the browser liveness monitor and the
//! shutdown path. Browser launch, the first build and profile setup stay in the TypeScript
//! launcher, which starts the sidecar once the browser is up.
//!
//! Shape: one `tokio::select!` loop over {the shutdown token, host notifications, watcher batches,
//! the static-bundle catch-up timer, the HMR injection timer, the liveness ticker}. A batch is
//! classified with [`crate::changes::classifier`], folded into a [`PendingState`] and drained into one
//! [`RebuildPlan`](crate::changes::classifier::RebuildPlan) at a time; the loop is sequential, so a
//! batch arriving mid-build waits in the (bounded) channel and is folded into the next window, never
//! run concurrently. Blocking work (hashing, copying files) lives behind [`Workspace`]. The loop is
//! generic over [`Host`], [`BrowserDriver`] and [`Workspace`], so its tests drive fakes under
//! `tokio::time::pause`.
//!
//! The ordering of the reload sequence is load-bearing and kept from the TypeScript: Firefox
//! segfaults the whole `YouTube` content process when a dynamic import fails inside a world a reload
//! just tore down. So a reload first waits out [`PUSH_SETTLE`] after the last import-triggering
//! push, tells the runtimes a reload is imminent, reloads, waits [`RELOAD_SETTLE`], and only then
//! pushes the manifest and re-injects the runtime.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::Value;
use tokio::sync::mpsc;
use tokio::time::{sleep, Instant};
use tokio_util::sync::CancellationToken;

use crate::bridge::protocol::{Notification, SidecarConfig};
use crate::bridge::Host;
use crate::changes::classifier::{InstallGate, PathRules, PendingState};
use crate::changes::watcher::ChangeBatch;
use crate::changes::workspace::{ScriptSnapshot, Workspace};
use crate::driver::BrowserDriver;
use crate::error::Result;
use crate::hmr_server::{HmrHandle, ManifestExtras};
use crate::types::{BrowserKind, RelPath};

use self::event_loop::Inputs;
use self::schedule::StaticBundle;

mod build;
mod event_loop;
mod rebuild;
mod resources;
mod schedule;
#[cfg(test)]
mod tests;

pub use self::schedule::InjectSchedule;

/// How long the extension teardown and boot reconcile take to land after a reload is initiated.
pub const RELOAD_SETTLE: Duration = Duration::from_millis(1500);
/// How long runtimes need to finish the dynamic imports a push set off.
pub const PUSH_SETTLE: Duration = Duration::from_millis(2000);
/// Attempts to inject the HMR runtime before giving up quietly.
pub const HMR_INJECT_MAX_ATTEMPTS: u32 = 15;
/// Delay between injection attempts.
pub const HMR_INJECT_RETRY_DELAY: Duration = Duration::from_millis(1000);
/// Quiet time after the last hot-swap before the static bundle is caught up.
pub const STATIC_CATCH_UP_IDLE: Duration = Duration::from_millis(1500);
/// How often the browser is probed when liveness is monitored.
pub const LIVENESS_POLL: Duration = Duration::from_millis(2000);
/// Failed probes in a row before the browser counts as gone.
pub const LIVENESS_MAX_FAILURES: u32 = 3;
/// Delay before a build that hit a transient file lock is retried.
pub const BUILD_RETRY_DELAY: Duration = Duration::from_millis(300);
/// Attempts of a build that keeps hitting a transient file lock.
pub const MAX_BUILD_ATTEMPTS: u32 = 3;

/// Everything the loop needs.
#[derive(Debug)]
pub struct Deps<H, D, W> {
    /// The TypeScript host.
    pub host: H,
    /// The browser reload driver.
    pub driver: D,
    /// Disk access.
    pub workspace: W,
    /// The HMR push channel.
    pub hmr: HmrHandle,
    /// The sidecar config.
    pub config: SidecarConfig,
    /// Debounced batches of changed files.
    pub changes: mpsc::Receiver<ChangeBatch>,
    /// One-way messages from the host.
    pub notifications: mpsc::Receiver<Notification>,
    /// The wall clock at start in epoch milliseconds; later times are derived from the (pausable)
    /// monotonic clock, so the loop never reads the system clock again.
    pub epoch_origin_ms: u64,
}

struct Orchestrator<H, D, W> {
    host: H,
    driver: D,
    files: W,
    hmr: HmrHandle,
    browser: BrowserKind,
    shutdown: CancellationToken,
    rules: PathRules,
    pending: PendingState,
    install_gate: InstallGate,
    last_changed: Option<RelPath>,
    static_bundle: StaticBundle,
    injection: InjectSchedule,
    is_liveness_monitored: bool,
    locale_catalogs: BTreeMap<RelPath, Value>,
    extras: ManifestExtras,
    /// The script outputs of the last successful full build. A failed build empties or half-writes
    /// the output directory, so the next build compares against this, never against that wreckage.
    last_built_scripts: Option<ScriptSnapshot>,
    origin: Instant,
    epoch_origin_ms: u64,
}

/// Runs until `shutdown` is cancelled, the host sends [`Notification::Shutdown`], the watcher ends
/// or the browser is gone.
pub async fn run<H, D, W>(deps: Deps<H, D, W>, shutdown: CancellationToken) -> Result<()>
where
    H: Host,
    D: BrowserDriver,
    W: Workspace,
{
    let Deps {
        host,
        driver,
        workspace,
        hmr,
        config,
        changes,
        notifications,
        epoch_origin_ms,
    } = deps;
    let install_hash = workspace
        .installed_lockfile_hash()
        .await
        .unwrap_or_default();
    let mut rules = PathRules::from_config(&config);
    rules.hmr_sources = config.hmr_source_files.iter().cloned().collect();
    let now = Instant::now();
    let mut orchestrator = Orchestrator {
        locale_catalogs: workspace.locale_catalogs().await.unwrap_or_default(),
        host,
        driver,
        files: workspace,
        hmr,
        browser: config.browser,
        shutdown,
        rules,
        pending: PendingState::default(),
        install_gate: InstallGate::new(install_hash),
        last_changed: None,
        static_bundle: StaticBundle::Current,
        injection: InjectSchedule::new(
            now,
            config.hmr_reinject_interval_ms.map(Duration::from_millis),
        ),
        is_liveness_monitored: config.is_liveness_monitored,
        extras: ManifestExtras::default(),
        last_built_scripts: None,
        origin: now,
        epoch_origin_ms,
    };
    orchestrator.log_build_outcome().await;
    orchestrator
        .event_loop(Inputs {
            changes,
            notifications,
        })
        .await;
    tracing::info!("Hot loop stopped");
    Ok(())
}

impl<H: Host, D: BrowserDriver, W: Workspace> Orchestrator<H, D, W> {
    /// Sleeps for `duration`, cut short by shutdown.
    async fn pause(&self, duration: Duration) {
        tokio::select! {
            () = sleep(duration) => {}
            () = self.shutdown.cancelled() => {}
        }
    }

    fn now_ms(&self) -> u64 {
        let elapsed = u64::try_from(self.origin.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.epoch_origin_ms.saturating_add(elapsed)
    }
}
