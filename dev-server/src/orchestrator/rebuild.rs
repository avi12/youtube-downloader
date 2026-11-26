//! Carrying out one [`RebuildPlan`]: the hot-swap, the HTML-only rebuild, the full rebuild with its
//! reload sequence, and the static-bundle catch-up once the edits go quiet. Port of
//! `rebuildAndReload`, `hotSwapDashboard`, `runReloadSequence` and `runStaticBundleCatchUp`.

use std::collections::BTreeSet;

use tokio::time::Instant;

use crate::bridge::protocol::{ChangedOutputs, ReloadExtensionParams};
use crate::bridge::Host;
use crate::changes::classifier::{classify_changed_outputs, RebuildPlan};
use crate::changes::workspace::Workspace;
use crate::driver::BrowserDriver;
use crate::error::Result;
use crate::orchestrator::schedule::StaticBundle;
use crate::orchestrator::{Orchestrator, PUSH_SETTLE, RELOAD_SETTLE};
use crate::types::BrowserKind;

/// When a rebuild began, on the monotonic clock for the timing logs and in epoch milliseconds for
/// the launcher, which compares it against file times.
#[derive(Debug, Clone, Copy)]
struct Started {
    instant: Instant,
    epoch_ms: u64,
}

impl Started {
    fn elapsed_ms(self) -> u128 {
        self.instant.elapsed().as_millis()
    }
}

impl<H: Host, D: BrowserDriver, W: Workspace> Orchestrator<H, D, W> {
    pub(super) async fn execute(&mut self, plan: RebuildPlan) -> Result<()> {
        let started = Started {
            instant: Instant::now(),
            epoch_ms: self.now_ms(),
        };
        let resources = match plan {
            RebuildPlan::ResourcesOnly { files } => files,
            RebuildPlan::HotSwap { resources } => {
                self.hot_swap_components(started).await?;
                resources
            }
            RebuildPlan::HtmlPages {
                entrypoints,
                resources,
            } => {
                self.rebuild_html_pages(&entrypoints, started).await?;
                resources
            }
            RebuildPlan::Full {
                is_env_change,
                resources,
            } => {
                self.rebuild_and_reload(is_env_change, started).await?;
                resources
            }
        };
        self.apply_resource_update(&resources).await
    }

    /// Port of `hotSwapDashboard`: rebuild only the HMR modules and push, never reload.
    /// A failed build wipes the output directory, leaving no manifest to hot-swap into, so the edit
    /// takes the full rebuild and reload instead.
    async fn hot_swap_components(&mut self, started: Started) -> Result<()> {
        if self.files.build_artifacts().await?.is_none() {
            tracing::warn!(
                "manifest.json is missing (the last build failed?) - full rebuild instead of a hot swap"
            );
            return self.rebuild_and_reload(false, started).await;
        }
        self.rebuild_hmr_with_extras().await?;
        self.broadcast_manifest().await?;
        self.static_bundle = StaticBundle::Stale;
        tracing::info!("Hot-swapped ({}ms) - HMR, no reload", started.elapsed_ms());
        Ok(())
    }

    /// Port of the full-reload branch of `rebuildAndReload`.
    async fn rebuild_and_reload(&mut self, is_env_change: bool, started: Started) -> Result<()> {
        if is_env_change {
            self.host.refresh_env().await?;
        }
        let before = match self.last_built_scripts.take() {
            Some(snapshot) => snapshot,
            None => self.files.script_snapshot().await?,
        };
        if let Err(error) = self.build_all().await {
            self.last_built_scripts = Some(before);
            return Err(error);
        }
        let after = self.files.script_snapshot().await?;
        let mut changed = classify_changed_outputs(&after.outputs, &before.hashes, &after.hashes);
        changed.is_main_world_content_script_changed = after.main_world != before.main_world;
        self.last_built_scripts = Some(after);
        self.run_reload_sequence(changed, started).await
    }

    /// Quiesce, reload, settle, re-arm: the one sequence allowed to tear content-script worlds down.
    async fn run_reload_sequence(&self, changed: ChangedOutputs, started: Started) -> Result<()> {
        let remaining_push_settle = self
            .hmr
            .since_last_import_push()
            .and_then(|since_push| PUSH_SETTLE.checked_sub(since_push));
        if let Some(remaining) = remaining_push_settle {
            self.pause(remaining).await;
        }
        self.hmr.broadcast_reload_imminent();
        self.reload_scripts(changed, started).await?;
        self.pause(RELOAD_SETTLE).await;
        self.broadcast_manifest().await?;
        self.host.inject_hmr().await?;
        Ok(())
    }

    /// Hands every rebuild to the launcher's reload target, which diffs the build output itself and
    /// applies the smallest update: refresh pages, reload the extension and re-inject its isolated
    /// content scripts in place, or reload the tabs a MAIN-world script runs in.
    async fn reload_scripts(&self, changed: ChangedOutputs, started: Started) -> Result<()> {
        let parameters = ReloadExtensionParams {
            changed,
            started_at_ms: started.epoch_ms,
        };
        self.host.reload_extension(parameters).await?;
        tracing::info!("Applied the rebuild ({}ms)", started.elapsed_ms());
        Ok(())
    }

    /// Port of the HTML-only branch of `rebuildAndReload`: the runtimes survive, so the manifest
    /// goes out right away and only the open pages of the changed entrypoints reload.
    async fn rebuild_html_pages(
        &mut self,
        entrypoints: &BTreeSet<String>,
        started: Started,
    ) -> Result<()> {
        self.build_all().await?;
        self.broadcast_manifest().await?;
        let mut reloaded = Vec::new();
        for entrypoint in entrypoints {
            let is_reloaded = self
                .driver
                .reload_extension_pages(entrypoint)
                .await
                .unwrap_or_else(|error| {
                    tracing::warn!("Could not reload the {entrypoint} pages: {error}");
                    false
                });
            if is_reloaded {
                reloaded.push(entrypoint.as_str());
            }
        }
        let note = match self.browser {
            BrowserKind::Firefox => {
                let refreshed = if reloaded.is_empty() {
                    "none".to_owned()
                } else {
                    reloaded.join(", ")
                };
                format!(" (open pages refreshed: {refreshed})")
            }
            _ => String::new(),
        };
        tracing::info!(
            "Reloaded ({}ms) - HTML-only{note}, extension context preserved",
            started.elapsed_ms()
        );
        Ok(())
    }

    /// Port of `runStaticBundleCatchUp`: after the edits stop, bring the static bundle up to date
    /// without reloading anything.
    pub(super) async fn run_static_catch_up(&mut self) {
        self.static_bundle = self.static_bundle.without_deadline();
        if !self.static_bundle.is_stale() || !self.pending.is_empty() {
            return;
        }
        let started = Instant::now();
        let outcome = async {
            self.build_all().await?;
            self.broadcast_manifest().await
        }
        .await;
        match outcome {
            Ok(()) => tracing::info!(
                "Static bundle caught up ({}ms) - a fresh page load now matches the live page",
                started.elapsed().as_millis()
            ),
            Err(error) => tracing::warn!(
                "Static bundle catch-up failed - retrying after the next edit: {error}"
            ),
        }
    }
}
