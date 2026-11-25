//! The one wording every browser target logs a reload outcome in. Port of the `describe*`
//! functions of `scripts/dev/browsers/reload-actions.ts`.

use serde::{Deserialize, Serialize};

use super::plan::{BackgroundSwapPlan, ExtensionReloadPlan, PageRefreshPlan};
use crate::output::manifest::describe_content_scripts;

/// A tab reloaded because in-place re-injection failed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub(crate) struct FailedInjection {
    pub(crate) url: String,
    pub(crate) message: String,
}

/// What the browser did to the open tabs.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub(crate) struct TabUpdateResult {
    pub(crate) stale_tab_count: usize,
    pub(crate) reinjected_tab_count: usize,
    /// One-shot MAIN-to-ISOLATED messages re-sent to the fresh scripts.
    pub(crate) replayed_handshake_count: usize,
    pub(crate) failed_injections: Vec<FailedInjection>,
}

/// What happened to one open extension page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub(crate) enum PageAction {
    /// The page was reloaded.
    #[serde(rename = "reloaded")]
    Reloaded,
    /// A document the background owns; it recreates it on next use.
    #[serde(rename = "closed - recreated on next use")]
    Closed,
    /// A document with downloads running in it; it closes once they end.
    #[serde(rename = "busy downloading - closes when downloads end")]
    Deferred,
}

impl PageAction {
    fn text(self) -> &'static str {
        match self {
            Self::Reloaded => "reloaded",
            Self::Closed => "closed - recreated on next use",
            Self::Deferred => "busy downloading - closes when downloads end",
        }
    }
}

/// One refreshed extension page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
pub(crate) struct RefreshedPage {
    pub(crate) name: String,
    pub(crate) action: PageAction,
}

pub(crate) fn describe_extension_reload(
    plan: &ExtensionReloadPlan,
    result: &TabUpdateResult,
) -> String {
    let mut fallback_messages: Vec<&str> = Vec::new();
    for reload in &result.failed_injections {
        if !fallback_messages.contains(&reload.message.as_str()) {
            fallback_messages.push(&reload.message);
        }
    }
    let mut outcomes = Vec::new();
    if result.reinjected_tab_count > 0 {
        let names = describe_content_scripts(&plan.isolated_content_scripts);
        let count = result.reinjected_tab_count;
        outcomes.push(format!(
            "hot-swapped content script {names} in {count} tab(s), page state kept"
        ));
    }
    if result.replayed_handshake_count > 0 {
        let count = result.replayed_handshake_count;
        outcomes.push(format!("re-sent {count} download panel handshake(s)"));
    }
    if result.reinjected_tab_count > 0 && !plan.changed_isolated_style_sheets.is_empty() {
        let files = plan.changed_isolated_style_sheets.join(", ");
        outcomes.push(format!(
            "CSS rules deleted from {files} since a tab was loaded stay applied in it until it reloads"
        ));
    }
    if result.stale_tab_count > 0 {
        let count = result.stale_tab_count;
        let names = describe_content_scripts(&plan.main_world_content_scripts);
        outcomes.push(format!(
            "{count} tab(s) keep the old MAIN-world content script {names} until you reload them"
        ));
    }
    if !fallback_messages.is_empty() {
        let count = result.failed_injections.len();
        let messages = fallback_messages.join("; ");
        outcomes.push(format!(
            "in-place re-injection failed in {count} tab(s), which keep the old script until you reload them: {messages}"
        ));
    }
    if outcomes.is_empty() {
        outcomes.push("no open YouTube tabs to update".to_owned());
    }
    let reasons = plan.reasons.join("; ");
    format!("Reloaded extension ({reasons}) - {}", outcomes.join(" - "))
}

pub(crate) fn describe_page_refresh(
    plan: &PageRefreshPlan,
    refreshed_pages: &[RefreshedPage],
) -> String {
    let changed_pages = plan
        .page_names
        .iter()
        .chain(&plan.shared_asset_files)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(", ");
    if refreshed_pages.is_empty() {
        return format!(
            "{changed_pages} changed - none open, the next open loads the new build; extension and YouTube tabs untouched"
        );
    }
    let outcomes: Vec<String> = refreshed_pages
        .iter()
        .map(|page| format!("{} {}", page.name, page.action.text()))
        .collect();
    let outcomes = outcomes.join(", ");
    format!("{changed_pages} changed - {outcomes}; extension and YouTube tabs untouched")
}

pub(crate) fn describe_background_swap(
    plan: &BackgroundSwapPlan,
    refreshed_pages: &[RefreshedPage],
) -> String {
    let files = plan.background_files.join(", ");
    let swapped = format!(
        "Swapped background {files} in place - extension, content scripts and YouTube tabs untouched"
    );
    let Some(page_refresh) = &plan.page_refresh else {
        return swapped;
    };
    format!(
        "{swapped}; {}",
        describe_page_refresh(page_refresh, refreshed_pages)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reload_plan() -> ExtensionReloadPlan {
        ExtensionReloadPlan {
            reasons: vec!["a changed".to_owned()],
            main_world_content_scripts: Vec::new(),
            isolated_content_scripts: Vec::new(),
            changed_isolated_style_sheets: Vec::new(),
        }
    }

    #[test]
    fn no_tabs_is_said_plainly() {
        let text = describe_extension_reload(&reload_plan(), &TabUpdateResult::default());
        assert_eq!(
            text,
            "Reloaded extension (a changed) - no open YouTube tabs to update"
        );
    }

    #[test]
    fn fallback_messages_are_deduplicated() {
        let reload = FailedInjection {
            url: "u".to_owned(),
            message: "boom".to_owned(),
        };
        let result = TabUpdateResult {
            failed_injections: vec![reload.clone(), reload],
            ..TabUpdateResult::default()
        };
        let text = describe_extension_reload(&reload_plan(), &result);
        assert!(text.ends_with("in-place re-injection failed in 2 tab(s), which keep the old script until you reload them: boom"));
    }

    #[test]
    fn page_refresh_with_and_without_open_pages() {
        let plan = PageRefreshPlan {
            page_names: vec!["popup".to_owned()],
            shared_asset_files: vec!["mux-worker.js".to_owned()],
        };
        assert!(describe_page_refresh(&plan, &[])
            .starts_with("popup, mux-worker.js changed - none open"));
        let pages = [RefreshedPage {
            name: "popup".to_owned(),
            action: PageAction::Reloaded,
        }];
        assert_eq!(
            describe_page_refresh(&plan, &pages),
            "popup, mux-worker.js changed - popup reloaded; extension and YouTube tabs untouched"
        );
    }
}
