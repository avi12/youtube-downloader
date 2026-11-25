//! Diffs two builds by content hash and turns the changed files into the smallest update that makes
//! them live in the running browser. Port of `scripts/dev/output/reload-plan.ts`.

use std::collections::BTreeSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::snapshot::BuildSnapshot;
use crate::output::error::Result;
use crate::output::manifest::{
    describe_content_scripts, ContentScriptEntry, ExtensionManifest, MANIFEST_FILE,
};

const LOCALES_DIR_PREFIX: &str = "_locales/";
const HTML_SUFFIX: &str = ".html";
const LIVE_LOADED_EXTENSIONS: [&str; 3] = ["html", "js", "css"];
const HASHED_ASSET_DIRS: [&str; 2] = ["chunks/", "assets/"];
const HASHED_ASSET_SUFFIXES: [&str; 2] = [".js", ".css"];
const ASSET_HASH_LENGTH: usize = 8;
/// The files of the content script the HMR runtime restarts by itself, without a browser update.
const HOT_CONTENT_SCRIPT_FILES: [&str; 2] =
    ["content-scripts/youtube.js", "content-scripts/youtube.css"];
const BACKGROUND_CHANGED_REASON: &str = "background changed";
const STALE_BACKGROUND_REASON: &str =
    "the browser started the background from a script it cached before this build";

/// HTML pages that changed, and shared files any open page may load.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageRefreshPlan {
    /// HTML entrypoints whose page changed (popup, offscreen, download-worker).
    pub(crate) page_names: Vec<String>,
    /// Changed files no single page owns (an unlisted worker script, a public asset).
    pub(crate) shared_asset_files: Vec<String>,
}

impl PageRefreshPlan {
    pub(crate) fn is_empty(&self) -> bool {
        self.page_names.is_empty() && self.shared_asset_files.is_empty()
    }
}

/// Reload the extension, re-inject the isolated scripts. Tabs are never reloaded.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionReloadPlan {
    pub(crate) reasons: Vec<String>,
    /// MAIN-world scripts that changed: a page-world script cannot be swapped, so their tabs are reported as stale.
    pub(crate) main_world_content_scripts: Vec<ContentScriptEntry>,
    /// Every isolated script: the extension reload orphans them all.
    pub(crate) isolated_content_scripts: Vec<ContentScriptEntry>,
    pub(crate) changed_isolated_style_sheets: Vec<String>,
}

/// Only the background changed: it restarts in place; `fallback` runs if that fails.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub(crate) struct BackgroundSwapPlan {
    pub(crate) background_files: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(test, ts(optional))]
    pub(crate) page_refresh: Option<PageRefreshPlan>,
    pub(crate) fallback: ExtensionReloadPlan,
}

/// What a rebuild needs from the browser, discriminated by `kind`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum ReloadPlan {
    /// Nothing changed.
    None,
    /// Refresh the open extension pages.
    RefreshPages(PageRefreshPlan),
    /// Restart the background in place.
    SwapBackground(BackgroundSwapPlan),
    /// Reload the extension.
    ReloadExtension(ExtensionReloadPlan),
}

fn diff_file_hashes(before: &BuildSnapshot, after: &BuildSnapshot) -> BTreeSet<String> {
    let files = before.file_hashes.keys().chain(after.file_hashes.keys());
    files
        .filter(|file| before.file_hashes.get(*file) != after.file_hashes.get(*file))
        .cloned()
        .collect()
}

fn collect_strings(value: &Value, strings: &mut BTreeSet<String>) {
    match value {
        Value::String(text) => {
            strings.insert(text.strip_prefix('/').unwrap_or(text).to_owned());
        }
        Value::Array(items) => items.iter().for_each(|item| collect_strings(item, strings)),
        Value::Object(fields) => fields
            .values()
            .for_each(|field| collect_strings(field, strings)),
        Value::Null | Value::Bool(_) | Value::Number(_) => {}
    }
}

/// Read only when the extension loads: the manifest, the files it names directly (icons, static
/// DNR rules) and the locale catalogs.
fn is_load_time_file(file: &str, manifest_strings: &BTreeSet<String>) -> bool {
    if file == MANIFEST_FILE || file.starts_with(LOCALES_DIR_PREFIX) {
        return true;
    }
    let extension = Path::new(file).extension().and_then(|text| text.to_str());
    let is_live_loaded = extension.is_some_and(|text| LIVE_LOADED_EXTENSIONS.contains(&text));
    manifest_strings.contains(file) && !is_live_loaded
}

/// Vite's content-hashed page chunks and styles: a change to one already shows as a changed page.
pub(crate) fn is_hashed_page_asset(file: &str) -> bool {
    let Some(body) = HASHED_ASSET_DIRS
        .iter()
        .find_map(|directory| file.strip_prefix(directory))
    else {
        return false;
    };
    let Some(stem) = HASHED_ASSET_SUFFIXES
        .iter()
        .find_map(|suffix| body.strip_suffix(suffix))
    else {
        return false;
    };
    let Some((hash_start, _)) = stem.char_indices().rev().nth(ASSET_HASH_LENGTH) else {
        return false;
    };
    let Some((head, tail)) = stem.split_at_checked(hash_start) else {
        return false;
    };
    let hash = tail.strip_prefix('-').unwrap_or_default();
    let is_word = |character: char| character.is_ascii_alphanumeric() || "_-".contains(character);
    !head.is_empty() && !hash.is_empty() && hash.chars().all(is_word)
}

fn plan_page_refresh(after: &BuildSnapshot, changed: &BTreeSet<String>) -> PageRefreshPlan {
    let page_names = changed
        .iter()
        .filter(|file| after.file_hashes.contains_key(*file))
        .filter_map(|file| file.strip_suffix(HTML_SUFFIX))
        .map(|stem| stem.rsplit('/').next().unwrap_or(stem).to_owned())
        .collect();
    let shared_asset_files = changed
        .iter()
        .filter(|file| !file.ends_with(HTML_SUFFIX) && !is_hashed_page_asset(file))
        .cloned()
        .collect();
    PageRefreshPlan {
        page_names,
        shared_asset_files,
    }
}

/// A changed manifest `content_scripts` list counts every script on either side as changed.
fn list_changed_content_scripts(
    before: &BuildSnapshot,
    after: &BuildSnapshot,
    changed: &BTreeSet<String>,
) -> Result<Vec<ContentScriptEntry>> {
    let mut scripts = after.manifest.list_content_scripts()?;
    let is_set_changed =
        before.manifest.content_scripts_value() != after.manifest.content_scripts_value();
    if is_set_changed {
        scripts.extend(before.manifest.list_content_scripts()?);
        return Ok(scripts);
    }
    scripts.retain(|entry| {
        entry
            .scripts
            .iter()
            .chain(&entry.css)
            .any(|file| changed.contains(file))
    });
    Ok(scripts)
}

fn plan_extension_reload(
    before: &BuildSnapshot,
    after: &BuildSnapshot,
    changed: &BTreeSet<String>,
    hot_files: &BTreeSet<String>,
) -> Result<Option<ReloadPlan>> {
    let changed_scripts = list_changed_content_scripts(before, after, changed)?;
    let (main_world, changed_isolated): (Vec<_>, Vec<_>) = changed_scripts
        .into_iter()
        .partition(ContentScriptEntry::is_main_world);
    let mut manifest_strings = BTreeSet::new();
    collect_strings(&after.manifest.0, &mut manifest_strings);
    let load_time_files: Vec<&str> = changed
        .iter()
        .filter(|file| is_load_time_file(file, &manifest_strings))
        .map(String::as_str)
        .collect();
    let background_files = after.manifest.background_files()?;
    let is_background_changed = background_files.iter().any(|file| changed.contains(file));
    let mut other_reasons = Vec::new();
    if !load_time_files.is_empty() {
        other_reasons.push(format!("{} changed", load_time_files.join(", ")));
    }
    if !changed_isolated.is_empty() {
        let names = describe_content_scripts(&changed_isolated);
        other_reasons.push(format!("content script {names} changed"));
    }
    if !main_world.is_empty() {
        let names = describe_content_scripts(&main_world);
        other_reasons.push(format!("MAIN-world content script {names} changed"));
    }
    if other_reasons.is_empty() && !is_background_changed {
        return Ok(None);
    }
    let mut reasons = Vec::new();
    if is_background_changed {
        reasons.push(BACKGROUND_CHANGED_REASON.to_owned());
    }
    let has_other_reasons = !other_reasons.is_empty();
    reasons.extend(other_reasons);
    let isolated_content_scripts = after.manifest.list_isolated_content_scripts()?;
    // The reload re-injects every isolated script, so a hot style sheet counts here too
    let changed_style_sheets = isolated_content_scripts
        .iter()
        .flat_map(|entry| &entry.css)
        .filter(|file| changed.contains(*file) || hot_files.contains(*file))
        .cloned()
        .collect();
    let fallback = ExtensionReloadPlan {
        reasons,
        main_world_content_scripts: main_world,
        isolated_content_scripts,
        changed_isolated_style_sheets: changed_style_sheets,
    };
    if has_other_reasons {
        return Ok(Some(ReloadPlan::ReloadExtension(fallback)));
    }
    let page_files: BTreeSet<String> = changed
        .iter()
        .filter(|file| !background_files.contains(file))
        .cloned()
        .collect();
    let page_refresh = plan_page_refresh(after, &page_files);
    Ok(Some(ReloadPlan::SwapBackground(BackgroundSwapPlan {
        background_files,
        page_refresh: Some(page_refresh).filter(|plan| !plan.is_empty()),
        fallback,
    })))
}

/// The smallest update that makes the changes between two builds live.
pub(crate) fn plan_reload(before: &BuildSnapshot, after: &BuildSnapshot) -> Result<ReloadPlan> {
    let mut changed = diff_file_hashes(before, after);
    // A changed manifest still needs the reload that registers the scripts again
    let hot_files: BTreeSet<String> = if changed.contains(MANIFEST_FILE) {
        BTreeSet::new()
    } else {
        HOT_CONTENT_SCRIPT_FILES
            .iter()
            .filter_map(|file| changed.take(*file))
            .collect()
    };
    if changed.is_empty() {
        return Ok(ReloadPlan::None);
    }
    if let Some(plan) = plan_extension_reload(before, after, &changed, &hot_files)? {
        return Ok(plan);
    }
    Ok(ReloadPlan::RefreshPages(plan_page_refresh(after, &changed)))
}

/// Chrome runs an unpacked extension's worker from the script it cached at install, so a profile
/// reused from an older session can start with stale code.
pub(crate) fn plan_stale_background_reload(manifest: &ExtensionManifest) -> Result<ReloadPlan> {
    Ok(ReloadPlan::ReloadExtension(ExtensionReloadPlan {
        reasons: vec![STALE_BACKGROUND_REASON.to_owned()],
        main_world_content_scripts: Vec::new(),
        isolated_content_scripts: manifest.list_isolated_content_scripts()?,
        changed_isolated_style_sheets: Vec::new(),
    }))
}

#[cfg(test)]
mod tests;
