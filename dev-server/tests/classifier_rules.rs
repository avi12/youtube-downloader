//! Behavior of the pure classifier through its public API.

use std::collections::{BTreeSet, HashSet};

use ytdl_dev_hot::bridge::protocol::HtmlEntrypoint;
use ytdl_dev_hot::changes::classifier::{
    classify_path, diff_locale_catalog, hash_installed_lockfile, hash_main_world_content_scripts,
    hash_script_outputs, is_path_in_entrypoint, main_world_script_files, plan_rebuild,
    plan_resource_update, InstallGate, PathClass, PathRules, PendingState, RebuildPlan,
    ResourceAction, ScriptOutputs, RESOURCE_HASH_LENGTH,
};
use ytdl_dev_hot::types::{ContentHash, RelPath};
use ytdl_dev_hot::Result;

fn rel(text: &str) -> RelPath {
    RelPath::new(text)
}

fn rules() -> PathRules {
    PathRules {
        env_files: vec![rel(".env"), rel(".env.local")],
        install_marker: Some(rel("../node_modules/.modules.yaml")),
        skipped_entrypoints: vec![
            rel("src/entrypoints/grant/"),
            rel("src/entrypoints/edge.content.ts"),
        ],
        html_entrypoints: vec![HtmlEntrypoint {
            name: "popup".to_owned(),
            watch_path: rel("src/entrypoints/popup/"),
        }],
        hmr_sources: HashSet::from([rel("src/dashboard/App.svelte")]),
    }
}

fn class_of(path: &str) -> PathClass {
    classify_path(&rules(), &rel(path))
}

fn recorded(edits: &[(&str, PathClass)]) -> PendingState {
    let mut state = PendingState::default();
    for (path, class) in edits {
        state.record(&rel(path), class);
    }
    state
}

#[test]
fn precedence_follows_schedule_rebuild() {
    assert_eq!(
        class_of("../node_modules/.modules.yaml"),
        PathClass::InstallMarker
    );
    assert_eq!(
        class_of("src/entrypoints/grant/index.html"),
        PathClass::SkippedEntrypoint
    );
    assert_eq!(
        class_of("src/entrypoints/edge.content.ts"),
        PathClass::SkippedEntrypoint
    );
    assert_eq!(
        class_of("src/public/_locales/en/messages.json"),
        PathClass::PublicResource
    );
    assert_eq!(class_of(".env.local"), PathClass::Env);
    assert_eq!(class_of("src/dashboard/App.svelte"), PathClass::HmrSource);
    assert_eq!(
        class_of("src/entrypoints/popup/main.ts"),
        PathClass::HtmlEntrypoint {
            name: "popup".to_owned()
        }
    );
    assert_eq!(class_of("src/lib/a.ts"), PathClass::Code);
}

#[test]
fn a_resource_never_touches_rebuild_latches() {
    let state = recorded(&[("src/public/a.png", PathClass::PublicResource)]);
    assert!(!state.has_code_change && !state.is_full_reload);
    assert_eq!(
        plan_rebuild(&state),
        Some(RebuildPlan::ResourcesOnly {
            files: BTreeSet::from([rel("src/public/a.png")])
        })
    );
}

#[test]
fn a_skipped_entrypoint_changes_nothing() {
    let state = recorded(&[("src/entrypoints/grant/a.ts", PathClass::SkippedEntrypoint)]);
    assert!(state.is_empty());
    assert_eq!(plan_rebuild(&state), None);
}

#[test]
fn hmr_only_hot_swaps_and_resources_ride_along() {
    let state = recorded(&[
        ("src/dashboard/App.svelte", PathClass::HmrSource),
        ("src/public/a.png", PathClass::PublicResource),
    ]);
    assert!(matches!(
        plan_rebuild(&state),
        Some(RebuildPlan::HotSwap { resources }) if resources.len() == 1
    ));
}

#[test]
fn a_code_edit_cancels_a_pending_hot_swap_for_good() {
    let state = recorded(&[
        ("src/dashboard/App.svelte", PathClass::HmrSource),
        ("src/lib/a.ts", PathClass::Code),
        ("src/dashboard/App.svelte", PathClass::HmrSource),
    ]);
    assert!(!state.is_hmr_only);
    assert!(matches!(
        plan_rebuild(&state),
        Some(RebuildPlan::Full { .. })
    ));
}

#[test]
fn a_coalesced_env_edit_is_not_downgraded() {
    let state = recorded(&[
        (".env", PathClass::Env),
        ("src/dashboard/App.svelte", PathClass::HmrSource),
    ]);
    assert!(matches!(
        plan_rebuild(&state),
        Some(RebuildPlan::Full {
            is_env_change: true,
            ..
        })
    ));
}

#[test]
fn html_edits_collect_until_a_code_edit_forces_a_full_reload() {
    let popup = PathClass::HtmlEntrypoint {
        name: "popup".to_owned(),
    };
    let state = recorded(&[("src/entrypoints/popup/a.ts", popup.clone())]);
    assert!(matches!(
        plan_rebuild(&state),
        Some(RebuildPlan::HtmlPages { entrypoints, .. }) if entrypoints.len() == 1
    ));
    let mut full = recorded(&[("src/lib/a.ts", PathClass::Code)]);
    full.record(&rel("src/entrypoints/popup/a.ts"), &popup);
    assert!(full.html_entrypoints.is_empty());
    assert!(matches!(
        plan_rebuild(&full),
        Some(RebuildPlan::Full { .. })
    ));
}

#[test]
fn take_resets_the_window() {
    let mut state = recorded(&[("src/lib/a.ts", PathClass::Code)]);
    assert!(!state.take().is_empty());
    assert!(state.is_empty());
}

#[test]
fn entrypoint_matching_is_directory_or_exact() {
    assert!(!is_path_in_entrypoint(
        &rel("src/e/a.content.tsx"),
        &rel("src/e/a.content.ts")
    ));
}

#[test]
fn resource_actions_split_locale_asset_and_unchanged() {
    let locale = rel("src/public/_locales/en/messages.json");
    assert!(matches!(
        plan_resource_update(&locale, b"{}", None),
        Some(ResourceAction::Locale { output_path }) if output_path == "_locales/en/messages.json"
    ));
    assert_eq!(
        plan_resource_update(&locale, b"{}", Some(b"{}")),
        Some(ResourceAction::Unchanged)
    );
    assert_eq!(plan_resource_update(&rel("src/lib/a.ts"), b"", None), None);
    assert!(matches!(
        plan_resource_update(&rel("src/public/a.png"), b"abc", None),
        Some(ResourceAction::Asset { version, .. }) if version.len() == RESOURCE_HASH_LENGTH
    ));
}

#[test]
fn locale_diff_reports_added_removed_and_edited_keys() -> Result<()> {
    let before = serde_json::json!({"a": {"message": "1"}, "gone": {"message": "x"}});
    let after = serde_json::json!({"a": {"message": "2"}, "new": {"message": "y"}});
    assert_eq!(diff_locale_catalog(&before, &after)?, ["a", "gone", "new"]);
    assert!(diff_locale_catalog(&before, &serde_json::json!([])).is_err());
    Ok(())
}

#[test]
fn install_gate_passes_only_real_changes() {
    let mut gate = InstallGate::new(None);
    assert!(!gate.is_dependency_set_changed(None));
    assert!(gate.is_dependency_set_changed(Some(ContentHash::from_bytes(b"1"))));
}

#[test]
fn main_world_manifest_files_are_listed() -> Result<()> {
    let manifest = r#"{"content_scripts":[{"world":"MAIN","js":["m.js"],"css":["m.css"]}]}"#;
    assert_eq!(
        main_world_script_files(manifest)?,
        [rel("m.js"), rel("m.css")]
    );
    Ok(())
}

#[test]
fn hashing_reads_real_files_and_skips_missing_ones() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("ytdl-classifier-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("bg.js"), b"1")?;
    std::fs::write(
        dir.join("manifest.json"),
        r#"{"content_scripts":[{"world":"MAIN","js":["m.js"]}]}"#,
    )?;
    std::fs::write(dir.join("m.js"), b"main")?;
    let outputs = ScriptOutputs {
        background_files: vec![rel("bg.js"), rel("absent.js")],
        content_script_files: Vec::new(),
    };
    assert_eq!(hash_script_outputs(&dir, &outputs)?.len(), 1);
    let first = hash_main_world_content_scripts(&dir)?;
    std::fs::write(dir.join("m.js"), b"main2")?;
    assert_ne!(first, hash_main_world_content_scripts(&dir)?);
    assert_eq!(hash_installed_lockfile(&dir.join("none.yaml"))?, None);
    std::fs::remove_dir_all(&dir)?;
    Ok(())
}
