//! Applies a reload plan to a browser target and words the outcome. Port of `applyReloadPlan` and
//! `swapBackground` of `scripts/dev/server/sidecar.ts`.

use std::path::Path;

use crate::dev::browsers::error::Result;
use crate::dev::browsers::swap::BackgroundSwapper;
use crate::dev::browsers::target::ReloadTarget;
use crate::dev::hmr::ContentScriptUpdate;
use crate::output::reload::{
    describe_background_swap, describe_extension_reload, describe_page_refresh, BackgroundSwapPlan,
    ReloadPlan,
};

/// Keeps a script ending in an expression without a semicolon from running into the next one.
const SCRIPT_SEPARATOR: &str = "\n;\n";
const NO_CHANGES: &str = "No output changes - skipped reload";
const RESTARTED_ONLY: &str =
    "No extension or tab reload needed - the YouTube content script restarts in place";
const PAGES_RELOAD_THEMSELVES: &str =
    "No extension reload needed - the pages running HMR modules reload themselves";

/// Everything one application of a plan needs.
pub(crate) struct ApplyRequest<'a> {
    /// What the rebuild needs from the browser.
    pub(crate) plan: &'a ReloadPlan,
    /// What the HMR runtime does by itself, which a plan of nothing still has to report.
    pub(crate) content_script_update: ContentScriptUpdate,
    /// The browser to apply it to.
    pub(crate) target: &'a dyn ReloadTarget,
    /// Keeps a swapped background swapped; told to forget on a full reload.
    pub(crate) swapper: &'a BackgroundSwapper,
    /// The build output directory the rebuilt background is read from.
    pub(crate) output_dir: &'a Path,
}

async fn read_background_script(output_dir: &Path, plan: &BackgroundSwapPlan) -> Result<String> {
    let mut sources = Vec::new();
    for file in &plan.background_files {
        sources.push(tokio::fs::read_to_string(output_dir.join(file)).await?);
    }
    Ok(sources.join(SCRIPT_SEPARATOR))
}

async fn try_swap(request: &ApplyRequest<'_>, plan: &BackgroundSwapPlan) -> Result<()> {
    let script = read_background_script(request.output_dir, plan).await?;
    request.swapper.swap(&script).await
}

/// A swap that fails (the background is unreachable, the new script throws) falls back to the reload.
async fn swap_background(request: &ApplyRequest<'_>, plan: &BackgroundSwapPlan) -> Result<String> {
    if let Err(error) = try_swap(request, plan).await {
        request.swapper.forget();
        let result = request.target.reload_extension(&plan.fallback).await?;
        let reload = describe_extension_reload(&plan.fallback, &result);
        return Ok(format!(
            "Swapping the background in place failed ({error}) - {reload}"
        ));
    }
    let refreshed_pages = match &plan.page_refresh {
        Some(refresh) => request.target.refresh_pages(refresh).await?,
        None => Vec::new(),
    };
    Ok(describe_background_swap(plan, &refreshed_pages))
}

fn describe_no_update(update: ContentScriptUpdate) -> &'static str {
    match update {
        ContentScriptUpdate::Unchanged => NO_CHANGES,
        ContentScriptUpdate::Restarted => RESTARTED_ONLY,
        ContentScriptUpdate::PageReloaded => PAGES_RELOAD_THEMSELVES,
    }
}

/// Applies a plan and returns the one logged sentence of its outcome.
pub(crate) async fn apply_reload_plan(request: &ApplyRequest<'_>) -> Result<String> {
    match request.plan {
        ReloadPlan::None => Ok(describe_no_update(request.content_script_update).to_owned()),
        ReloadPlan::RefreshPages(plan) => {
            let refreshed_pages = request.target.refresh_pages(plan).await?;
            Ok(describe_page_refresh(plan, &refreshed_pages))
        }
        ReloadPlan::SwapBackground(plan) => swap_background(request, plan).await,
        ReloadPlan::ReloadExtension(plan) => {
            request.swapper.forget();
            let result = request.target.reload_extension(plan).await?;
            Ok(describe_extension_reload(plan, &result))
        }
    }
}

#[cfg(test)]
pub(super) mod fake {
    use std::sync::Mutex;

    use serde_json::Value;

    use crate::dev::browsers::target::{BoxFuture, ReloadTarget};
    use crate::output::reload::{
        ExtensionReloadPlan, PageAction, PageRefreshPlan, RefreshedPage, TabUpdateResult,
    };

    /// A target that records what it was asked and fails scripts on demand.
    #[derive(Default)]
    pub(in crate::dev::browsers) struct FakeTarget {
        scripts: Mutex<Vec<String>>,
        reloads: Mutex<usize>,
        is_failing: bool,
    }

    impl FakeTarget {
        pub(in crate::dev::browsers) fn failing() -> Self {
            Self {
                is_failing: true,
                ..Self::default()
            }
        }

        pub(in crate::dev::browsers) fn scripts(&self) -> Vec<String> {
            self.scripts.lock().unwrap().clone()
        }

        pub(in crate::dev::browsers) fn reloads(&self) -> usize {
            *self.reloads.lock().unwrap()
        }
    }

    impl ReloadTarget for FakeTarget {
        fn reload_extension<'a>(
            &'a self,
            _plan: &'a ExtensionReloadPlan,
        ) -> BoxFuture<'a, TabUpdateResult> {
            Box::pin(async move {
                *self.reloads.lock().unwrap() += 1;
                Ok(TabUpdateResult::default())
            })
        }

        fn refresh_pages<'a>(
            &'a self,
            plan: &'a PageRefreshPlan,
        ) -> BoxFuture<'a, Vec<RefreshedPage>> {
            Box::pin(async move {
                Ok(plan
                    .page_names
                    .iter()
                    .map(|name| RefreshedPage {
                        name: name.clone(),
                        action: PageAction::Reloaded,
                    })
                    .collect())
            })
        }

        fn evaluate_in_background<'a>(&'a self, _expression: &'a str) -> BoxFuture<'a, Value> {
            Box::pin(async { Ok(Value::Null) })
        }

        fn run_script_in_background<'a>(&'a self, script: &'a str) -> BoxFuture<'a, ()> {
            Box::pin(async move {
                if self.is_failing {
                    return Err(crate::dev::browsers::BrowserError::Protocol(
                        "down".to_owned(),
                    ));
                }
                self.scripts.lock().unwrap().push(script.to_owned());
                Ok(())
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use crate::dev::browsers::plan::fake::FakeTarget;
    use crate::dev::browsers::plan::*;
    use crate::output::reload::{ExtensionReloadPlan, PageRefreshPlan};

    fn reload_plan() -> ExtensionReloadPlan {
        ExtensionReloadPlan {
            reasons: vec!["manifest.json changed".to_owned()],
            main_world_content_scripts: Vec::new(),
            isolated_content_scripts: Vec::new(),
            changed_isolated_style_sheets: Vec::new(),
        }
    }

    fn swap_plan(file: &str) -> ReloadPlan {
        ReloadPlan::SwapBackground(BackgroundSwapPlan {
            background_files: vec![file.to_owned()],
            page_refresh: Some(PageRefreshPlan {
                page_names: vec!["popup".to_owned()],
                shared_asset_files: Vec::new(),
            }),
            fallback: reload_plan(),
        })
    }

    async fn apply(plan: &ReloadPlan, fake: &Arc<FakeTarget>, dir: &Path) -> String {
        let swapper = BackgroundSwapper::new(fake.clone(), Arc::new(|_| {}));
        let request = ApplyRequest {
            plan,
            content_script_update: ContentScriptUpdate::Unchanged,
            target: fake.as_ref(),
            swapper: &swapper,
            output_dir: dir,
        };
        let outcome = apply_reload_plan(&request).await.unwrap();
        swapper.forget();
        outcome
    }

    #[tokio::test]
    async fn no_change_skips_the_reload() {
        let fake = Arc::new(FakeTarget::default());
        let outcome = apply(&ReloadPlan::None, &fake, Path::new(".")).await;
        assert_eq!(outcome, NO_CHANGES);
        assert_eq!(fake.reloads(), 0);
    }

    #[test]
    fn a_restart_is_not_reported_as_no_change() {
        let outcome = describe_no_update(ContentScriptUpdate::Restarted);
        assert_eq!(outcome, RESTARTED_ONLY);
    }

    #[tokio::test]
    async fn a_swap_runs_the_background_and_refreshes_pages() {
        let dir = std::env::temp_dir().join("ytdl-browsers-swap-ok");
        tokio::fs::create_dir_all(&dir).await.unwrap();
        tokio::fs::write(dir.join("background.js"), "var a = 1")
            .await
            .unwrap();
        let fake = Arc::new(FakeTarget::default());
        let outcome = apply(&swap_plan("background.js"), &fake, &dir).await;
        assert!(outcome.starts_with("Swapped background background.js in place"));
        assert!(outcome.contains("popup reloaded"));
        assert_eq!(fake.reloads(), 0);
    }

    #[tokio::test]
    async fn a_failed_swap_falls_back_to_the_reload() {
        let dir = std::env::temp_dir().join("ytdl-browsers-swap-fail");
        tokio::fs::create_dir_all(&dir).await.unwrap();
        tokio::fs::write(dir.join("background.js"), "var a = 1")
            .await
            .unwrap();
        let fake = Arc::new(FakeTarget::failing());
        let outcome = apply(&swap_plan("background.js"), &fake, &dir).await;
        assert!(outcome.starts_with("Swapping the background in place failed"));
        assert!(outcome.contains("Reloaded extension (manifest.json changed)"));
        assert_eq!(fake.reloads(), 1);
    }
}
