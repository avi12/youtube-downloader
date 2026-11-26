//! Code edits: hot-swaps, full reloads in their load-bearing order, HTML-only rebuilds and edits
//! the loop must ignore.

use std::time::Duration;

use serde_json::json;
use tokio::time::sleep;

use crate::orchestrator::tests::fakes::snapshot;
use crate::orchestrator::tests::harness::start;
use crate::orchestrator::{PUSH_SETTLE, RELOAD_SETTLE};

#[tokio::test(start_paused = true)]
async fn an_hmr_graph_edit_hot_swaps_then_catches_the_bundle_up() {
    let mut harness = start(&json!({}), |_| {}).await;
    harness.touch(&["src/a.svelte"]).await;
    harness.settle().await;
    let calls = harness.log.entries();
    assert_eq!(
        calls,
        ["inject", "rebuildHmr", "build", "rebuildHmr"],
        "hot swap, then the idle catch-up build; never a reload"
    );
    assert_eq!(harness.drain_pushes().len(), 2);
    assert_eq!(harness.files.state.lock().unwrap().extras.len(), 2);
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn an_hmr_graph_edit_after_a_failed_build_rebuilds_in_full() {
    let harness = start(&json!({}), |state| {
        state.is_manifest_missing = true;
    })
    .await;
    harness.touch(&["src/a.svelte"]).await;
    harness.settle().await;
    let calls = harness.log.entries();
    assert_eq!(
        calls[..5],
        ["inject", "snapshot", "build", "rebuildHmr", "snapshot"],
        "a wiped output dir has no manifest to hot-swap into, so the edit takes the full build"
    );
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_background_change_reloads_the_extension_in_the_right_order() {
    let mut harness = start(&json!({}), |state| {
        state.snapshots.push_back(snapshot(b"old", b""));
        state.snapshots.push_back(snapshot(b"new", b""));
    })
    .await;
    harness.touch(&["src/lib/a.ts"]).await;
    harness.settle().await;
    let calls = harness.log.entries();
    assert_eq!(
        calls,
        [
            "inject",
            "snapshot",
            "build",
            "rebuildHmr",
            "snapshot",
            "reload",
            "inject"
        ]
    );
    let pushes = harness.drain_pushes();
    assert_eq!(
        pushes,
        [r#"{"type":"reload-imminent"}"#, r#"{"type":"manifest"}"#]
    );
    let reload = harness.log.time_of("reload", 0);
    let reinject = harness.log.time_of("inject", 1);
    assert!(
        reinject - reload >= RELOAD_SETTLE,
        "settle before re-inject"
    );
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_reload_waits_out_the_tail_of_the_last_push() {
    let harness = start(&json!({}), |state| {
        state.snapshots.push_back(snapshot(b"old", b""));
        state.snapshots.push_back(snapshot(b"new", b""));
    })
    .await;
    harness.touch(&["src/a.svelte"]).await;
    sleep(Duration::from_millis(10)).await;
    harness.touch(&["src/lib/a.ts"]).await;
    harness.settle().await;
    let pushed = harness.log.time_of("rebuildHmr", 0);
    let reloaded = harness.log.time_of("reload", 0);
    assert!(
        reloaded - pushed >= PUSH_SETTLE,
        "a reload inside the push settle window kills in-flight imports"
    );
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn an_unchanged_build_still_asks_the_launcher() {
    let harness = start(&json!({}), |_| {}).await;
    harness.touch(&["src/lib/a.ts"]).await;
    harness.settle().await;
    assert_eq!(harness.log.count("reload"), 1);
    assert_eq!(harness.log.count("tabs"), 0);
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_main_world_change_is_left_to_the_launcher() {
    let harness = start(&json!({}), |state| {
        state.snapshots.push_back(snapshot(b"", b"old"));
        state.snapshots.push_back(snapshot(b"", b"new"));
    })
    .await;
    harness.touch(&["src/lib/a.ts"]).await;
    harness.settle().await;
    assert_eq!(
        harness.log.count("tabs"),
        0,
        "the launcher reloads the tabs"
    );
    assert_eq!(harness.log.count("reload"), 1);
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_failed_build_does_not_pass_for_a_main_world_change() {
    let harness = start(&json!({}), |state| {
        state.snapshots.push_back(snapshot(b"one", b"main"));
        state.snapshots.push_back(snapshot(b"two", b"main"));
        state.snapshots.push_back(snapshot(b"", b""));
        state.snapshots.push_back(snapshot(b"three", b"main"));
    })
    .await;
    harness.touch(&["src/lib/a.ts"]).await;
    harness.settle().await;
    harness
        .build_failures
        .lock()
        .unwrap()
        .push_back("Rolldown: parse error".to_owned());
    harness.touch(&["src/lib/a.ts"]).await;
    harness.settle().await;
    harness.touch(&["src/lib/a.ts"]).await;
    harness.settle().await;
    let reloads = harness.files.state.lock().unwrap().reloads.clone();
    assert_eq!(reloads.len(), 2, "both good builds moved the background");
    assert!(
        reloads.iter().all(|changed| changed.is_background_changed
            && !changed.is_main_world_content_script_changed),
        "the wiped output of the failed build is not the baseline"
    );
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn an_env_edit_refreshes_the_environment_before_building() {
    let harness = start(&json!({}), |_| {}).await;
    harness.touch(&[".env"]).await;
    harness.settle().await;
    let calls = harness.log.entries();
    assert_eq!(calls.get(1).map(String::as_str), Some("env"));
    assert_eq!(calls.get(2).map(String::as_str), Some("snapshot"));
    assert_eq!(calls.get(3).map(String::as_str), Some("build"));
    assert_eq!(
        harness.log.count("reload"),
        1,
        "the launcher diffs the output"
    );
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn an_html_entrypoint_edit_reloads_only_its_pages() {
    let harness = start(&json!({}), |_| {}).await;
    harness.touch(&["src/entrypoints/popup/App.svelte"]).await;
    harness.settle().await;
    assert_eq!(
        harness.log.entries(),
        ["inject", "build", "rebuildHmr", "pages:popup"]
    );
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn an_edit_under_a_skipped_entrypoint_does_nothing() {
    let harness = start(&json!({}), |_| {}).await;
    harness.touch(&["src/entrypoints/grant/App.svelte"]).await;
    harness.settle().await;
    assert_eq!(harness.log.entries(), ["inject"]);
    harness.stop().await.unwrap();
}
