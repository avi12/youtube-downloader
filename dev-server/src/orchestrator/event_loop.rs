//! The `select!` loop and its event handlers: notifications, watcher batches folded into the
//! pending latches and drained into rebuild windows, the injection timer and the liveness probe.
//! Port of the watcher callbacks, `scheduleRebuild` and `drainPendingRebuild`.

use std::ops::ControlFlow;

use tokio::sync::mpsc;
use tokio::time::{interval_at, sleep_until, Instant, MissedTickBehavior};

use crate::bridge::protocol::Notification;
use crate::bridge::Host;
use crate::changes::classifier::{classify_path, plan_rebuild, PathClass};
use crate::changes::watcher::ChangeBatch;
use crate::changes::workspace::Workspace;
use crate::driver::BrowserDriver;
use crate::orchestrator::{Orchestrator, LIVENESS_MAX_FAILURES, LIVENESS_POLL};
use crate::types::RelPath;

/// The channels the loop reads besides its own timers.
pub(super) struct Inputs {
    pub(super) changes: mpsc::Receiver<ChangeBatch>,
    pub(super) notifications: mpsc::Receiver<Notification>,
}

/// Sleeps until `deadline`, or forever when there is none (the `select!` arm is disabled then).
async fn sleep_until_some(deadline: Option<Instant>) {
    sleep_until(deadline.unwrap_or_else(Instant::now)).await;
}

impl<H: Host, D: BrowserDriver, W: Workspace> Orchestrator<H, D, W> {
    pub(super) async fn event_loop(&mut self, mut inputs: Inputs) {
        let shutdown = self.shutdown.clone();
        let mut liveness = interval_at(Instant::now() + LIVENESS_POLL, LIVENESS_POLL);
        liveness.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut failed_probes = 0_u32;
        loop {
            let catch_up = self.static_bundle.deadline();
            let injection = self.injection.next();
            let flow = tokio::select! {
                biased;
                () = shutdown.cancelled() => ControlFlow::Break(()),
                note = inputs.notifications.recv() => Self::on_notification(note),
                batch = inputs.changes.recv() => self.on_batch(batch, &mut inputs.changes).await,
                () = sleep_until_some(catch_up), if catch_up.is_some() => {
                    self.run_static_catch_up().await;
                    ControlFlow::Continue(())
                }
                () = sleep_until_some(injection), if injection.is_some() => {
                    self.run_injection().await;
                    ControlFlow::Continue(())
                }
                _ = liveness.tick(), if self.is_liveness_monitored => {
                    self.check_liveness(&mut failed_probes).await
                }
            };
            if flow.is_break() {
                return;
            }
        }
    }

    const fn on_notification(note: Option<Notification>) -> ControlFlow<()> {
        match note {
            Some(Notification::Shutdown) | None => ControlFlow::Break(()),
        }
    }

    async fn on_batch(
        &mut self,
        batch: Option<ChangeBatch>,
        changes: &mut mpsc::Receiver<ChangeBatch>,
    ) -> ControlFlow<()> {
        let Some(batch) = batch else {
            return ControlFlow::Break(());
        };
        self.ingest(batch).await;
        self.drain(changes).await;
        self.static_bundle = self.static_bundle.schedule_after_drain(Instant::now());
        ControlFlow::Continue(())
    }

    async fn check_liveness(&self, failed_probes: &mut u32) -> ControlFlow<()> {
        if self.driver.is_alive().await {
            *failed_probes = 0;
            return ControlFlow::Continue(());
        }
        *failed_probes += 1;
        if *failed_probes < LIVENESS_MAX_FAILURES {
            return ControlFlow::Continue(());
        }
        tracing::info!("The browser is no longer reachable - shutting down dev server");
        ControlFlow::Break(())
    }

    async fn run_injection(&mut self) {
        let is_injected = self.host.inject_hmr().await.unwrap_or_else(|error| {
            tracing::debug!("HMR injection failed: {error}");
            false
        });
        self.injection.record(is_injected, Instant::now());
    }

    /// Folds a batch into the latches. Port of the per-path half of `scheduleRebuild`.
    async fn ingest(&mut self, batch: ChangeBatch) {
        for event in batch.events {
            self.ingest_path(&event.path).await;
        }
    }

    async fn ingest_path(&mut self, path: &RelPath) {
        let class = classify_path(&self.rules, path);
        match class {
            PathClass::InstallMarker => {
                let hash = self
                    .files
                    .installed_lockfile_hash()
                    .await
                    .unwrap_or_default();
                if !self.install_gate.is_dependency_set_changed(hash) {
                    return;
                }
            }
            PathClass::SkippedEntrypoint => {
                tracing::info!(
                    "Ignored {} - its entrypoint is not in this browser's build",
                    path.as_str()
                );
                return;
            }
            PathClass::PublicResource => {}
            _ => {
                self.static_bundle = self.static_bundle.without_deadline();
                self.last_changed = Some(path.clone());
            }
        }
        self.pending.record(path, &class);
    }

    /// Runs the pending windows one after another until nothing is pending. Port of
    /// `drainPendingRebuild`.
    async fn drain(&mut self, changes: &mut mpsc::Receiver<ChangeBatch>) {
        loop {
            while let Ok(batch) = changes.try_recv() {
                self.ingest(batch).await;
            }
            if self.shutdown.is_cancelled() {
                return;
            }
            let state = self.pending.take();
            let last_changed = self.last_changed.take();
            let Some(plan) = plan_rebuild(&state) else {
                return;
            };
            if let Some(path) = last_changed.filter(|_| state.has_code_change) {
                tracing::info!("Change detected: {} - rebuilding", path.as_str());
            }
            if let Err(error) = self.execute(plan).await {
                tracing::warn!("Rebuild failed: {error}");
            }
        }
    }
}
