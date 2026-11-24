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
