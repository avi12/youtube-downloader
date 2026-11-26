//! The JavaScript each target evaluates inside the extension's background, built from the `.js`
//! assets under `assets/browsers/`. Each asset is one function expression called with JSON config.

use std::collections::BTreeSet;
use std::time::Duration;

use serde::Serialize;

use crate::output::manifest::ContentScriptEntry;
use crate::output::patches::replay_function_source;
use crate::output::reload::{ExtensionReloadPlan, PageRefreshPlan};

/// WXT's `ContentScriptContext` invalidates itself when a newer copy of the same content script
/// announces itself on document with this suffix after `<runtime.id>:<content script name>`, which
/// unmounts every UI and runs every `onInvalidated` cleanup the script registered.
pub(super) const WXT_SCRIPT_STARTED_EVENT_SUFFIX: &str = ":wxt:content-script-started";
/// The message id the dev server announces itself with.
pub(super) const WXT_SCRIPT_STARTED_MESSAGE_ID: &str = "ytdl-dev-server";

const TAB_UPDATE: &str = include_str!("../../../assets/browsers/tab-update.js");
const TEARDOWN: &str = include_str!("../../../assets/browsers/teardown.js");
const PAGE_REFRESH: &str = include_str!("../../../assets/browsers/page-refresh.js");
/// Resolves to the version of the swapped background that is running, or null.
pub(super) const RUNNING_VERSION: &str =
    include_str!("../../../assets/browsers/expressions/running-version.js");
/// A function that removes one listener from the object it is called on.
pub(super) const REMOVE_LISTENER: &str =
    include_str!("../../../assets/browsers/expressions/remove-listener.js");
/// A function that calls an orphan's WXT "newer script started" listener directly.
pub(super) const INVOKE_STARTED_LISTENER: &str =
    include_str!("../../../assets/browsers/expressions/invoke-started-listener.js");
/// True in an isolated world whose extension was reloaded.
pub(super) const ORPHANED_WORLD_PROBE: &str =
    include_str!("../../../assets/browsers/expressions/orphaned-world-probe.js");
/// The manifest name, read in the service worker.
pub(super) const MANIFEST_NAME: &str =
    include_str!("../../../assets/browsers/expressions/manifest-name.js");
/// Reloads the extension from inside its background.
pub(super) const RUNTIME_RELOAD: &str =
    include_str!("../../../assets/browsers/expressions/runtime-reload.js");

/// A function resolving to true while the extension has a running download.
const IS_DOWNLOADING: &str = include_str!("../../../assets/browsers/expressions/is-downloading.js");
const DEFER_CLOSE_WHILE_DOWNLOADING: &str =
    include_str!("../../../assets/browsers/expressions/defer-close-while-downloading.js");
const WAIT_UNTIL_DOWNLOADS_END: &str =
    include_str!("../../../assets/browsers/expressions/wait-until-downloads-end.js");

const EXTENSION_RELOAD: &str = include_str!("../../../assets/browsers/extension-reload.js");
const EXTENSION_ID_BY_NAME: &str = include_str!("../../../assets/browsers/extension-id-by-name.js");

/// Reloads an extension from a `chrome://extensions` page, which needs no live worker.
pub(super) fn extension_reload(extension_id: &str) -> serde_json::Result<String> {
    Ok(invoke(
        EXTENSION_RELOAD,
        &[serde_json::to_string(extension_id)?],
    ))
}

/// Resolves to the id of the installed extension with this manifest name, or null.
pub(super) fn extension_id_by_name(name: &str) -> serde_json::Result<String> {
    Ok(invoke(
        EXTENSION_ID_BY_NAME,
        &[serde_json::to_string(name)?],
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TabUpdateConfig<'a> {
    main_world_patterns: Vec<&'a str>,
    isolated_content_scripts: &'a [ContentScriptEntry],
    swappable_main_world_scripts: &'a [ContentScriptEntry],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TeardownConfig<'a> {
    content_script_names: Vec<&'a str>,
    patterns: Vec<&'a str>,
    started_event_suffix: &'a str,
    message_id: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PageRefreshConfig<'a> {
    page_names: &'a [String],
    is_shared_asset_changed: bool,
}

fn unique<'a>(values: impl Iterator<Item = &'a String>) -> Vec<&'a str> {
    let set: BTreeSet<&str> = values.map(String::as_str).collect();
    set.into_iter().collect()
}

/// `(asset)(arg, arg, ...)`, each argument already JavaScript source.
fn invoke(asset: &str, arguments: &[String]) -> String {
    format!("({})({})", asset.trim(), arguments.join(", "))
}

/// Run in the service worker: true while downloads run, closing the offscreen document once they
/// end.
pub(super) fn defer_close_while_downloading() -> String {
    invoke(
        DEFER_CLOSE_WHILE_DOWNLOADING,
        &[IS_DOWNLOADING.trim().to_owned()],
    )
}

/// Run in the background: resolves to true once no download runs, or to false when downloads still
/// run after `limit`.
pub(super) fn wait_until_downloads_end(limit: Duration) -> String {
    invoke(
        WAIT_UNTIL_DOWNLOADS_END,
        &[
            IS_DOWNLOADING.trim().to_owned(),
            limit.as_millis().to_string(),
        ],
    )
}

/// Counts the tabs an unswappable MAIN-world change leaves stale, re-injects the swappable ones and
/// every ISOLATED script into the complete, non-discarded tabs they match, and replays the
/// handshakes the isolated scripts missed.
pub(super) fn tab_update(plan: &ExtensionReloadPlan) -> serde_json::Result<String> {
    let config = TabUpdateConfig {
        main_world_patterns: unique(
            plan.main_world_content_scripts
                .iter()
                .flat_map(|entry| &entry.matches),
        ),
        isolated_content_scripts: &plan.isolated_content_scripts,
        swappable_main_world_scripts: &plan.swappable_main_world_scripts,
    };
    Ok(invoke(
        TAB_UPDATE,
        &[serde_json::to_string(&config)?, replay_function_source()],
    ))
}

/// Tells every live ISOLATED content script to tear down before the add-on reload destroys its
/// sandbox without running any cleanup.
pub(super) fn teardown(plan: &ExtensionReloadPlan) -> serde_json::Result<String> {
    let config = TeardownConfig {
        content_script_names: unique(
            plan.isolated_content_scripts
                .iter()
                .flat_map(|entry| &entry.names),
        ),
        patterns: unique(
            plan.isolated_content_scripts
                .iter()
                .flat_map(|entry| &entry.matches),
        ),
        started_event_suffix: WXT_SCRIPT_STARTED_EVENT_SUFFIX,
        message_id: WXT_SCRIPT_STARTED_MESSAGE_ID,
    };
    Ok(invoke(TEARDOWN, &[serde_json::to_string(&config)?]))
}

/// Refreshes the open extension views a page refresh plan names (Firefox).
pub(super) fn page_refresh(plan: &PageRefreshPlan) -> serde_json::Result<String> {
    let config = PageRefreshConfig {
        page_names: &plan.page_names,
        is_shared_asset_changed: !plan.shared_asset_files.is_empty(),
    };
    Ok(invoke(
        PAGE_REFRESH,
        &[
            serde_json::to_string(&config)?,
            IS_DOWNLOADING.trim().to_owned(),
        ],
    ))
}

#[cfg(test)]
mod tests {
    use crate::dev::browsers::scripts::*;
    use crate::output::manifest::ContentScriptWorld;

    fn plan() -> ExtensionReloadPlan {
        let entry = |world, matches: &str| ContentScriptEntry {
            names: vec!["youtube".to_owned()],
            world,
            matches: vec![matches.to_owned()],
            scripts: vec!["content-scripts/youtube.js".to_owned()],
            css: Vec::new(),
            is_all_frames: false,
        };
        ExtensionReloadPlan {
            reasons: Vec::new(),
            main_world_content_scripts: vec![entry(ContentScriptWorld::Main, "*://a.com/*")],
            swappable_main_world_scripts: Vec::new(),
            isolated_content_scripts: vec![entry(ContentScriptWorld::Isolated, "*://b.com/*")],
            changed_isolated_style_sheets: Vec::new(),
        }
    }

    #[test]
    fn tab_update_carries_patterns_scripts_and_the_replay_function() {
        let source = tab_update(&plan()).unwrap();
        assert!(source.contains(r#""mainWorldPatterns":["*://a.com/*"]"#));
        assert!(source.contains(r#""js":["content-scripts/youtube.js"]"#));
        assert!(source.contains("__ytdlDevCrossWorldRecords"));
        assert!(source.ends_with(')'));
    }

    #[test]
    fn teardown_lists_names_and_patterns_once() {
        let source = teardown(&plan()).unwrap();
        assert!(source.contains(r#""contentScriptNames":["youtube"]"#));
        assert!(source.contains(r#""patterns":["*://b.com/*"]"#));
        assert!(source.contains(WXT_SCRIPT_STARTED_EVENT_SUFFIX));
    }

    #[test]
    fn page_refresh_flags_shared_assets() {
        let refresh = PageRefreshPlan {
            page_names: vec!["popup".to_owned()],
            shared_asset_files: vec!["worker.js".to_owned()],
        };
        let source = page_refresh(&refresh).unwrap();
        assert!(source.contains(r#""pageNames":["popup"]"#));
        assert!(source.contains(r#""isSharedAssetChanged":true"#));
    }
}

#[cfg(test)]
mod reload_order_tests {
    use crate::dev::browsers::scripts::*;

    #[test]
    fn the_extensions_page_reload_enables_developer_mode_first_and_verifies_after() {
        let source = extension_reload("abc").unwrap();
        let positions: Vec<_> = [
            "updateProfileConfiguration",
            "'reload'",
            "getExtensionsInfo",
            "'setEnabled'",
        ]
        .iter()
        .map(|call| source.find(call))
        .collect();
        assert!(positions.iter().all(Option::is_some));
        assert!(positions.is_sorted());
        assert!(source.ends_with("(\"abc\")"));
    }
}
