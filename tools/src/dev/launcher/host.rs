//! The in-process [`Host`]: what the hot loop asks of the launcher (builds, the reload) answered
//! directly, where the TypeScript launcher answered over JSON lines.

use std::future::{ready, Future};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex;
use ytdl_dev_hot::bridge::protocol::{EntrypointLayout, RebuildHmrResult, ReloadExtensionParams};
use ytdl_dev_hot::bridge::Host;

use super::build::{build_hmr_modules, build_with_lock_retry};
use super::error::Result;
use super::log::{format_elapsed, log_event};
use crate::dev::browsers::{apply_reload_plan, ApplyRequest, BackgroundSwapper, ReloadTarget};
use crate::output::manifest::ExtensionManifest;
use crate::output::options::DevOptions;
use crate::output::reload::{
    plan_reload, plan_stale_background_reload, take_build_snapshot, BuildSnapshot, ReloadPlan,
};

// The background's dev prelude is missing only when the browser ran a script it cached before
// this build
const HAS_DEV_PRELUDE_SOURCE: &str = "typeof globalThis.ytdlDevBackground === \"object\"";

pub(super) fn now_epoch_milliseconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(0))
}

fn host_error(error: impl std::fmt::Display) -> ytdl_dev_hot::Error {
    ytdl_dev_hot::Error::Host {
        message: error.to_string(),
    }
}

/// The launcher side of the hot loop.
pub(super) struct DevHost {
    options: DevOptions,
    output_dir: PathBuf,
    target: Arc<dyn ReloadTarget>,
    swapper: BackgroundSwapper,
    last_snapshot: Mutex<BuildSnapshot>,
}

impl DevHost {
    pub(super) fn new(
        options: DevOptions,
        output_dir: PathBuf,
        target: Arc<dyn ReloadTarget>,
    ) -> Result<Self> {
        let last_snapshot = Mutex::new(take_build_snapshot(&output_dir)?);
        let swapper = BackgroundSwapper::new(Arc::clone(&target), Arc::new(log_event));
        Ok(Self {
            options,
            output_dir,
            target,
            swapper,
            last_snapshot,
        })
    }

    async fn apply(&self, plan: &ReloadPlan) -> Result<String> {
        Ok(apply_reload_plan(&ApplyRequest {
            plan,
            target: self.target.as_ref(),
            swapper: &self.swapper,
            output_dir: &self.output_dir,
        })
        .await?)
    }

    /// A browser that ran a background script cached before this build has no dev prelude, and a
    /// background swap could not undo that copy's listeners, so one reload replaces it.
    pub(super) async fn reload_if_background_stale(&self) -> Result<()> {
        let has_dev_prelude = self
            .target
            .evaluate_in_background(HAS_DEV_PRELUDE_SOURCE)
            .await
            .ok()
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        if has_dev_prelude {
            return Ok(());
        }
        let plan = plan_stale_background_reload(&ExtensionManifest::read(&self.output_dir)?)?;
        log_event(&self.apply(&plan).await?);
        Ok(())
    }
}

impl Host for DevHost {
    async fn build_extension(&self) -> ytdl_dev_hot::Result<Option<EntrypointLayout>> {
        build_with_lock_retry(&self.options)
            .await
            .map_err(host_error)?;
        Ok(None)
    }

    async fn rebuild_hmr(&self) -> ytdl_dev_hot::Result<RebuildHmrResult> {
        let hmr_source_files = build_hmr_modules(&self.options, &self.output_dir)
            .await
            .map_err(host_error)?;
        Ok(RebuildHmrResult { hmr_source_files })
    }

    async fn reload_extension(&self, params: ReloadExtensionParams) -> ytdl_dev_hot::Result<()> {
        let next = take_build_snapshot(&self.output_dir).map_err(host_error)?;
        let mut last = self.last_snapshot.lock().await;
        let plan = plan_reload(&last, &next).map_err(host_error)?;
        let outcome = self.apply(&plan).await.map_err(host_error)?;
        let elapsed = now_epoch_milliseconds().saturating_sub(params.started_at_ms);
        log_event(&format!("{outcome} ({})", format_elapsed(elapsed)));
        *last = next;
        Ok(())
    }

    fn inject_hmr(&self) -> impl Future<Output = ytdl_dev_hot::Result<bool>> + Send {
        ready(Ok(true))
    }

    fn refresh_env(&self) -> impl Future<Output = ytdl_dev_hot::Result<()>> + Send {
        ready(Ok(()))
    }
}
