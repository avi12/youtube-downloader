//! The Chrome reload target. Port of `scripts/dev/browsers/chrome/target.ts`.

use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use futures_util::future::join_all;
use serde_json::Value;
use tokio::time::Instant;
use ytdl_dev_hot::driver::cdp::{CdpClient, CdpTarget, TargetKind};
use ytdl_dev_hot::types::Port;

use super::extensions_page::evaluate_on_extensions_page;
use super::worlds::neutralize_orphaned_worlds_in_page;
use crate::cdp::wire::{close_target, evaluate_on, Method, Session};
use crate::dev::browsers::error::{BrowserError, Result};
use crate::dev::browsers::scripts::{self, MANIFEST_NAME};
use crate::dev::browsers::target::{BoxFuture, ReloadTarget};
use crate::output::manifest::matches_url_pattern;
use crate::output::reload::{
    ExtensionReloadPlan, PageAction, PageRefreshPlan, RefreshedPage, TabUpdateResult,
};

const SERVICE_WORKER_WAIT: Duration = Duration::from_secs(10);
const SERVICE_WORKER_POLL: Duration = Duration::from_millis(200);
const EXTENSION_URL_PREFIX: &str = "chrome-extension://";
const HTML_SUFFIX: &str = ".html";

/// A Chrome-family browser reached over its remote debugging port.
pub(crate) struct ChromeTarget {
    port: Port,
    client: CdpClient,
    /// The manifest name: Chrome names a content script's isolated world after it.
    extension_name: Option<String>,
    extension_id: Mutex<Option<String>>,
}

fn is_extension_service_worker(target: &CdpTarget) -> bool {
    target.kind == TargetKind::ServiceWorker
        && target.url.starts_with(EXTENSION_URL_PREFIX)
        && target.debugger_url().is_some()
}

fn extension_id_of(target: &CdpTarget) -> Option<&str> {
    target
        .url
        .strip_prefix(EXTENSION_URL_PREFIX)?
        .split('/')
        .next()
}

fn first_extension_id(targets: &[CdpTarget]) -> Option<String> {
    targets.iter().find_map(extension_id_of).map(str::to_owned)
}

fn page_name_of(url: &str) -> Option<&str> {
    let path = url.strip_prefix(EXTENSION_URL_PREFIX)?.split_once('/')?.1;
    let file = path.split(['?', '#']).next()?;
    file.strip_suffix(HTML_SUFFIX)?.rsplit('/').next()
}

fn debugger_url_of(target: &CdpTarget) -> Result<&str> {
    target
        .debugger_url()
        .ok_or_else(|| BrowserError::Protocol(format!("{} has no debugger URL", target.id)))
}

impl ChromeTarget {
    /// A target on a browser's remote debugging port; any extension service worker will do.
    pub(crate) const fn new(port: Port) -> Self {
        Self {
            port,
            client: CdpClient::new(port),
            extension_name: None,
            extension_id: Mutex::new(None),
        }
    }

    /// Picks the extension by manifest name among the profile's other extensions.
    #[must_use]
    pub(crate) fn with_extension_name(mut self, name: String) -> Self {
        self.extension_name = Some(name);
        self
    }

    fn known_id(&self) -> Option<String> {
        self.extension_id
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    async fn list_targets(&self) -> Vec<CdpTarget> {
        self.client.list_targets().await.unwrap_or_default()
    }

    /// The dev profile may carry other extensions whose worker is also `background.js`, so the
    /// first match is by manifest name; after that, by id.
    async fn is_own_service_worker(&self, target: &CdpTarget) -> bool {
        if let Some(id) = self.known_id() {
            return extension_id_of(target) == Some(id.as_str());
        }
        if let Some(wanted) = &self.extension_name {
            let name = match evaluate_on(target, MANIFEST_NAME.trim()).await {
                Ok(evaluation) => evaluation.into_value().ok(),
                Err(_) => None,
            };
            if name.as_ref().and_then(Value::as_str) != Some(wanted.as_str()) {
                return false;
            }
        }
        let Some(id) = extension_id_of(target) else {
            return false;
        };
        *self
            .extension_id
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(id.to_owned());
        true
    }

    /// The extension's live worker, without waiting; `stale` is the worker a reload is tearing down.
    async fn live_service_worker(&self, stale: Option<&CdpTarget>) -> Option<CdpTarget> {
        for target in self.list_targets().await {
            let is_stale = stale.is_some_and(|old| old.id == target.id);
            if is_extension_service_worker(&target)
                && !is_stale
                && self.is_own_service_worker(&target).await
            {
                return Some(target);
            }
        }
        None
    }

    /// Waits for the worker a fresh extension start brings up.
    async fn find_service_worker(&self, stale: Option<&CdpTarget>) -> Result<CdpTarget> {
        let deadline = Instant::now() + SERVICE_WORKER_WAIT;
        while Instant::now() < deadline {
            if let Some(worker) = self.live_service_worker(stale).await {
                return Ok(worker);
            }
            tokio::time::sleep(SERVICE_WORKER_POLL).await;
        }
        Err(BrowserError::Timeout("the extension's service worker"))
    }

    /// Chrome stops an idle worker, so there may be none: callers fall back to a full reload.
    async fn evaluate_in_worker(&self, expression: &str) -> Result<Value> {
        let worker = self
            .live_service_worker(None)
            .await
            .ok_or(BrowserError::Timeout("a running service worker"))?;
        Ok(evaluate_on(&worker, expression).await?.into_value()?)
    }

    /// The id from any extension page or worker target, else by manifest name on the extensions page.
    async fn resolve_extension_id(&self) -> Result<String> {
        if let Some(id) = self.known_id() {
            return Ok(id);
        }
        let id = match &self.extension_name {
            Some(name) => self.extension_id_by_name(name).await?,
            None => first_extension_id(&self.list_targets().await),
        };
        let id = id.ok_or(BrowserError::Timeout("the extension id"))?;
        *self
            .extension_id
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(id.clone());
        Ok(id)
    }

    async fn extension_id_by_name(&self, name: &str) -> Result<Option<String>> {
        let value =
            evaluate_on_extensions_page(self.port, &scripts::extension_id_by_name(name)?).await?;
        Ok(value.as_str().map(str::to_owned))
    }

    async fn neutralize_orphaned_content_scripts(&self, plan: &ExtensionReloadPlan) {
        let patterns: Vec<&String> = plan
            .isolated_content_scripts
            .iter()
            .flat_map(|entry| &entry.matches)
            .collect();
        let targets = self.list_targets().await;
        let pages = targets.iter().filter(|target| {
            target.kind == TargetKind::Page
                && target.debugger_url().is_some()
                && patterns
                    .iter()
                    .any(|pattern| matches_url_pattern(&target.url, pattern))
        });
        let world_name = self.extension_name.as_deref().unwrap_or_default();
        let outcomes = join_all(pages.map(|page| async move {
            let outcome = neutralize_orphaned_worlds_in_page(page, world_name).await;
            (page, outcome)
        }))
        .await;
        for (page, outcome) in outcomes {
            if let Err(error) = outcome {
                eprintln!(
                    "Could not neutralize the orphaned content scripts in {}: {error}",
                    page.url
                );
            }
        }
    }

    /// Always through the extensions page: `runtime.reload()` from the worker makes branded Chrome
    /// disable a command-line-loaded extension as an "unsupported developer extension".
    async fn reload_extension_process(&self) -> Result<()> {
        let id = self.resolve_extension_id().await?;
        evaluate_on_extensions_page(self.port, &scripts::extension_reload(&id)?).await?;
        Ok(())
    }

    async fn reload_extension_now(&self, plan: &ExtensionReloadPlan) -> Result<TabUpdateResult> {
        let known = self.known_id();
        let stale = self.list_targets().await.into_iter().find(|target| {
            is_extension_service_worker(target) && extension_id_of(target) == known.as_deref()
        });
        self.reload_extension_process().await?;
        // A reload that leaves the extension disabled is undone by a second one
        let worker = if let Ok(worker) = self.find_service_worker(stale.as_ref()).await {
            worker
        } else {
            self.reload_extension_process().await?;
            self.find_service_worker(stale.as_ref()).await?
        };
        self.neutralize_orphaned_content_scripts(plan).await;
        let source = scripts::tab_update(plan)?;
        let value = evaluate_on(&worker, &source).await?.into_value()?;
        Ok(serde_json::from_value(value)?)
    }

    async fn list_affected_pages(
        &self,
        plan: &PageRefreshPlan,
    ) -> Result<Vec<(CdpTarget, String)>> {
        let prefix = format!(
            "{EXTENSION_URL_PREFIX}{}/",
            self.resolve_extension_id().await?
        );
        let is_any_page_affected = !plan.shared_asset_files.is_empty();
        Ok(self
            .list_targets()
            .await
            .into_iter()
            .filter(|target| target.url.starts_with(&prefix))
            .filter_map(|target| {
                let name = page_name_of(&target.url)?.to_owned();
                (is_any_page_affected || plan.page_names.contains(&name)).then_some((target, name))
            })
            .collect())
    }

    /// Pages open in a tab or the action popup reload in place; a document the background owns (the
    /// offscreen document) is closed so the background recreates it from the new build on next use.
    /// Frames inside those documents (download-worker iframes) go with their host.
    async fn refresh_page(&self, target: &CdpTarget) -> Result<Option<PageAction>> {
        match target.kind {
            TargetKind::Page => {
                let mut session = Session::open(debugger_url_of(target)?).await?;
                let outcome = session
                    .call(Method::PageReload, serde_json::json!({}))
                    .await;
                session.close().await;
                outcome?;
                Ok(Some(PageAction::Reloaded))
            }
            TargetKind::Other => {
                close_target(self.port.get(), &target.id.to_string()).await?;
                Ok(Some(PageAction::Closed))
            }
            _ => Ok(None),
        }
    }

    async fn refresh_pages_now(&self, plan: &PageRefreshPlan) -> Result<Vec<RefreshedPage>> {
        let mut refreshed = Vec::new();
        for (target, name) in self.list_affected_pages(plan).await? {
            if let Some(action) = self.refresh_page(&target).await? {
                refreshed.push(RefreshedPage { name, action });
            }
        }
        Ok(refreshed)
    }
}

impl ReloadTarget for ChromeTarget {
    fn reload_extension<'a>(
        &'a self,
        plan: &'a ExtensionReloadPlan,
    ) -> BoxFuture<'a, TabUpdateResult> {
        Box::pin(self.reload_extension_now(plan))
    }

    fn refresh_pages<'a>(&'a self, plan: &'a PageRefreshPlan) -> BoxFuture<'a, Vec<RefreshedPage>> {
        Box::pin(self.refresh_pages_now(plan))
    }

    fn evaluate_in_background<'a>(&'a self, expression: &'a str) -> BoxFuture<'a, Value> {
        Box::pin(self.evaluate_in_worker(expression))
    }

    /// The completion value of a whole bundle is whatever its last statement left, so it is dropped.
    fn run_script_in_background<'a>(&'a self, script: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(async move {
            self.evaluate_in_worker(&format!("{script}\n;undefined"))
                .await?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_extension_id_is_the_url_host() {
        let target: CdpTarget = serde_json::from_value(serde_json::json!({
            "id": "1", "type": "service_worker",
            "url": "chrome-extension://abcdef/background.js",
            "webSocketDebuggerUrl": "ws://x"
        }))
        .unwrap();
        assert_eq!(extension_id_of(&target), Some("abcdef"));
        assert!(is_extension_service_worker(&target));
    }

    fn target(kind: &str, url: &str) -> CdpTarget {
        serde_json::from_value(serde_json::json!({
            "id": url, "type": kind, "url": url, "webSocketDebuggerUrl": "ws://x"
        }))
        .unwrap()
    }

    #[test]
    fn the_id_comes_from_any_extension_target() {
        let targets = [
            target("page", "https://example.com/"),
            target("other", "chrome-extension://offscreenid/offscreen.html"),
            target(
                "service_worker",
                "chrome-extension://workerid/background.js",
            ),
        ];
        assert_eq!(first_extension_id(&targets), Some("offscreenid".to_owned()));
        assert_eq!(first_extension_id(&targets[..1]), None);
    }

    #[test]
    fn a_sleeping_worker_is_not_a_worker_target() {
        let targets = [target("other", "chrome-extension://id/offscreen.html")];
        assert!(!targets.iter().any(is_extension_service_worker));
        let awake = [target(
            "service_worker",
            "chrome-extension://id/background.js",
        )];
        assert!(awake.iter().any(is_extension_service_worker));
    }

    #[test]
    fn page_names_come_from_html_paths() {
        assert_eq!(
            page_name_of("chrome-extension://id/popup.html?x=1"),
            Some("popup")
        );
        assert_eq!(
            page_name_of("chrome-extension://id/sub/offscreen.html"),
            Some("offscreen")
        );
        assert_eq!(page_name_of("chrome-extension://id/background.js"), None);
        assert_eq!(page_name_of("https://example.com/popup.html"), None);
    }
}
