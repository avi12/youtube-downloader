//! The build steps every rebuild shares: the extension build, the HMR module build with the
//! manifest extras written back, the transient file-lock retry and the manifest push.

use std::future::Future;

use tokio::time::sleep;

use super::schedule::StaticBundle;
use super::{Orchestrator, BUILD_RETRY_DELAY, MAX_BUILD_ATTEMPTS};
use crate::bridge::protocol::EntrypointLayout;
use crate::bridge::Host;
use crate::changes::workspace::Workspace;
use crate::driver::BrowserDriver;
use crate::error::{Error, Result};

/// The error codes Windows file locks surface as while the browser holds extension files open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransientFsCode {
    Eperm,
    Ebusy,
}

impl TransientFsCode {
    const ALL: [Self; 2] = [Self::Eperm, Self::Ebusy];

    const fn as_str(self) -> &'static str {
        match self {
            Self::Eperm => "EPERM",
            Self::Ebusy => "EBUSY",
        }
    }
}

/// Runs a host build step again when it died on a transient Windows file lock: the browser holds
/// extension files open while it reads them, so a build-time delete or write can fail with `EPERM`
/// or `EBUSY`. Port of `runBuildWithFsRetry`.
async fn with_fs_retry<T, F, Fut>(mut run: F) -> Result<T>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T>>,
{
    let mut attempt = 1;
    loop {
        match run().await {
            Err(error) if attempt < MAX_BUILD_ATTEMPTS && is_transient_fs_error(&error) => {
                tracing::info!(
                    "Build hit a transient file lock (attempt {attempt}/{MAX_BUILD_ATTEMPTS}) - retrying"
                );
                sleep(BUILD_RETRY_DELAY).await;
                attempt += 1;
            }
            outcome => return outcome,
        }
    }
}

fn is_transient_fs_error(error: &Error) -> bool {
    let text = error.to_string();
    TransientFsCode::ALL
        .iter()
        .any(|code| text.contains(code.as_str()))
}

impl<H: Host, D: BrowserDriver, W: Workspace> Orchestrator<H, D, W> {
    /// Builds the extension and its HMR modules. The WXT build empties the output
    /// directory and rewrites `manifest.json`, wiping the HMR modules and the WAR patch, so the
    /// HMR build always follows it.
    pub(super) async fn build_all(&mut self) -> Result<()> {
        if let Some(layout) = with_fs_retry(|| self.host.build_extension()).await? {
            self.apply_layout(layout);
        }
        self.rebuild_hmr_with_extras().await?;
        self.static_bundle = StaticBundle::Current;
        self.last_built_scripts = None;
        self.log_build_outcome().await;
        Ok(())
    }

    fn apply_layout(&mut self, layout: EntrypointLayout) {
        self.rules.html_entrypoints = layout.html_entrypoints;
        self.rules.skipped_entrypoints = layout.skipped_entrypoints;
    }

    pub(super) async fn rebuild_hmr_with_extras(&mut self) -> Result<()> {
        let graph = with_fs_retry(|| async {
            let graph = self.host.rebuild_hmr().await?;
            self.write_extras().await?;
            Ok(graph)
        })
        .await?;
        self.rules.hmr_sources = graph.hmr_source_files.into_iter().collect();
        Ok(())
    }

    /// Writes the session's manifest extras (locale overlay, resource versions) into the output.
    pub(super) async fn write_extras(&self) -> Result<()> {
        self.files.write_manifest_extras(self.extras.clone()).await
    }

    pub(super) async fn log_build_outcome(&self) {
        match self.files.build_artifacts().await {
            Ok(Some(artifacts)) => tracing::info!(
                "Build artifacts OK - manifest.json {}B, hmr {} files",
                artifacts.manifest_bytes,
                artifacts.hmr_file_count
            ),
            Ok(None) => tracing::warn!(
                "[dev] WARNING: build finished but manifest.json is MISSING - output dir is inconsistent (interrupted or racing build?); the loaded extension's resources will be denied until the next clean build"
            ),
            Err(error) => tracing::warn!("Could not inspect the build output: {error}"),
        }
    }

    pub(super) async fn broadcast_manifest(&self) -> Result<()> {
        if let Some(payload) = self.files.manifest_payload().await? {
            self.hmr.broadcast_manifest(&payload);
        }
        Ok(())
    }
}
