use serde_json::json;

use super::*;

fn snapshot(files: &[(&str, &str)], manifest: Value) -> BuildSnapshot {
    BuildSnapshot {
        file_hashes: files
            .iter()
            .map(|(file, hash)| ((*file).to_owned(), (*hash).to_owned()))
            .collect(),
        manifest: ExtensionManifest(manifest),
    }
}

fn manifest() -> Value {
    json!({
        "background": {"service_worker": "bg.js"},
        "content_scripts": [
            {"js": ["content-scripts/iso.js"], "css": ["content-scripts/iso.css"], "matches": ["*://*/*"]},
            {"js": ["content-scripts/main.js"], "world": "MAIN", "matches": ["*://*/*"]}
        ],
        "icons": {"16": "/icon.png"}
    })
}

const BASE: [(&str, &str); 6] = [
    ("manifest.json", "m"),
    ("bg.js", "1"),
    ("content-scripts/iso.js", "1"),
    ("content-scripts/iso.css", "1"),
    ("content-scripts/main.js", "1"),
    ("popup.html", "1"),
];

fn changed(file: &str) -> BuildSnapshot {
    let files: Vec<(&str, &str)> = BASE
        .iter()
        .map(|(name, hash)| (*name, if *name == file { "2" } else { *hash }))
        .collect();
    snapshot(&files, manifest())
}

#[test]
fn identical_builds_need_nothing() -> Result<()> {
    let build = snapshot(&BASE, manifest());
    assert_eq!(plan_reload(&build, &build)?, ReloadPlan::None);
    Ok(())
}

#[test]
fn a_background_only_change_swaps_in_place() -> Result<()> {
    let plan = plan_reload(&snapshot(&BASE, manifest()), &changed("bg.js"))?;
    let ReloadPlan::SwapBackground(swap) = plan else {
        return Err(crate::output::error::OutputError::Invalid(format!(
            "{plan:?}"
        )));
    };
    assert_eq!(swap.background_files, vec!["bg.js".to_owned()]);
    assert_eq!(swap.page_refresh, None);
    assert_eq!(
        swap.fallback.reasons,
        vec![BACKGROUND_CHANGED_REASON.to_owned()]
    );
    Ok(())
}

#[test]
fn a_content_script_change_reloads_the_extension() -> Result<()> {
    let plan = plan_reload(
        &snapshot(&BASE, manifest()),
        &changed("content-scripts/iso.css"),
    )?;
    let ReloadPlan::ReloadExtension(reload) = plan else {
        return Err(crate::output::error::OutputError::Invalid(format!(
            "{plan:?}"
        )));
    };
    assert_eq!(
        reload.reasons,
        vec!["content script iso changed".to_owned()]
    );
    assert_eq!(
        reload.changed_isolated_style_sheets,
        vec!["content-scripts/iso.css".to_owned()]
    );
    assert_eq!(reload.isolated_content_scripts.len(), 1);
    Ok(())
}

#[test]
fn a_main_world_change_names_its_tabs() -> Result<()> {
    let plan = plan_reload(
        &snapshot(&BASE, manifest()),
        &changed("content-scripts/main.js"),
    )?;
    let ReloadPlan::ReloadExtension(reload) = plan else {
        return Err(crate::output::error::OutputError::Invalid(format!(
            "{plan:?}"
        )));
    };
    assert_eq!(reload.main_world_content_scripts.len(), 1);
    Ok(())
}

#[test]
fn an_html_only_change_refreshes_the_page() -> Result<()> {
    let plan = plan_reload(&snapshot(&BASE, manifest()), &changed("popup.html"))?;
    let expected = PageRefreshPlan {
        page_names: vec!["popup".to_owned()],
        shared_asset_files: Vec::new(),
    };
    assert_eq!(plan, ReloadPlan::RefreshPages(expected));
    Ok(())
}

#[test]
fn hashed_assets_are_recognised() {
    assert!(is_hashed_page_asset("chunks/popup-AbCd1234.js"));
    assert!(is_hashed_page_asset("assets/z-b_cdef12.css"));
    assert!(!is_hashed_page_asset("chunks/popup.js"));
    assert!(!is_hashed_page_asset("other/popup-AbCd1234.js"));
    assert!(!is_hashed_page_asset("chunks/-AbCd1234.js"));
}

#[test]
fn the_plan_serialises_with_a_kebab_kind() -> Result<()> {
    let text = serde_json::to_string(&ReloadPlan::None)?;
    assert_eq!(text, r#"{"kind":"none"}"#);
    Ok(())
}

fn hot_manifest() -> Value {
    json!({
        "background": {"service_worker": "bg.js"},
        "content_scripts": [
            {"js": ["content-scripts/youtube.js"], "css": ["content-scripts/youtube.css"], "matches": ["*://*/*"]},
            {"js": ["content-scripts/main.js"], "world": "MAIN", "matches": ["*://*/*"]}
        ]
    })
}

const HOT_BASE: [(&str, &str); 6] = [
    ("manifest.json", "m"),
    ("bg.js", "1"),
    ("content-scripts/youtube.js", "1"),
    ("content-scripts/youtube.css", "1"),
    ("content-scripts/main.js", "1"),
    ("chunks/shared.js", "1"),
];

/// The youtube content script files change, along with `others`.
fn plan_hot_change(others: &[&str]) -> Result<ReloadPlan> {
    let files: Vec<(&str, &str)> = HOT_BASE
        .iter()
        .map(|(name, hash)| {
            let is_changed = HOT_CONTENT_SCRIPT_FILES.contains(name) || others.contains(name);
            (*name, if is_changed { "2" } else { *hash })
        })
        .collect();
    plan_reload(
        &snapshot(&HOT_BASE, hot_manifest()),
        &snapshot(&files, hot_manifest()),
    )
}

#[test]
fn a_hot_content_script_change_alone_needs_nothing() -> Result<()> {
    assert_eq!(plan_hot_change(&[])?, ReloadPlan::None);
    Ok(())
}

#[test]
fn a_hot_change_stays_out_of_a_background_swap() -> Result<()> {
    let plan = plan_hot_change(&["bg.js"])?;
    let ReloadPlan::SwapBackground(swap) = plan else {
        return Err(crate::output::error::OutputError::Invalid(format!(
            "{plan:?}"
        )));
    };
    assert_eq!(swap.page_refresh, None);
    assert_eq!(swap.fallback.isolated_content_scripts.len(), 1);
    assert_eq!(
        swap.fallback.changed_isolated_style_sheets,
        vec!["content-scripts/youtube.css".to_owned()]
    );
    Ok(())
}

#[test]
fn a_hot_change_beside_a_main_world_change_still_reloads() -> Result<()> {
    let plan = plan_hot_change(&["content-scripts/main.js", "bg.js"])?;
    let ReloadPlan::ReloadExtension(reload) = plan else {
        return Err(crate::output::error::OutputError::Invalid(format!(
            "{plan:?}"
        )));
    };
    assert_eq!(reload.main_world_content_scripts.len(), 1);
    assert_eq!(reload.isolated_content_scripts.len(), 1);
    assert_eq!(
        reload.changed_isolated_style_sheets,
        vec!["content-scripts/youtube.css".to_owned()]
    );
    Ok(())
}

#[test]
fn a_hot_change_beside_a_shared_file_refreshes_only_that_file() -> Result<()> {
    let expected = PageRefreshPlan {
        page_names: Vec::new(),
        shared_asset_files: vec!["chunks/shared.js".to_owned()],
    };
    assert_eq!(
        plan_hot_change(&["chunks/shared.js"])?,
        ReloadPlan::RefreshPages(expected)
    );
    Ok(())
}
