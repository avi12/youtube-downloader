//! Edits that skip the build or gate it: installs, locale strings and public assets.

use serde_json::json;

use super::harness::start;
use crate::types::{ContentHash, RelPath};

#[tokio::test(start_paused = true)]
async fn an_install_rebuilds_only_when_the_dependency_set_changed() {
    let harness = start(&json!({}), |_| {}).await;
    harness.touch(&["../node_modules/.modules.yaml"]).await;
    harness.settle().await;
    assert_eq!(
        harness.log.count("build"),
        0,
        "same lockfile: a no-op install"
    );
    harness.files.state.lock().unwrap().lockfile = Some(ContentHash::from_bytes(b"new"));
    harness.touch(&["../node_modules/.modules.yaml"]).await;
    harness.settle().await;
    assert_eq!(harness.log.count("build"), 1);
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_locale_edit_updates_the_overlay_without_building() {
    let path = "src/public/_locales/en/messages.json";
    let mut harness = start(&json!({}), |state| {
        state
            .catalogs
            .insert(RelPath::new(path), json!({"hello": {"message": "old"}}));
        state.public.insert(
            path.to_owned(),
            br#"{"hello":{"message":"new"},"bye":{"message":"bye"}}"#.to_vec(),
        );
    })
    .await;
    harness.touch(&[path]).await;
    harness.settle().await;
    assert_eq!(harness.log.entries(), ["inject"], "no build, no reload");
    {
        let state = harness.files.state.lock().unwrap();
        assert_eq!(state.extras.len(), 1);
        assert_eq!(state.extras[0].overlay.len(), 2);
        assert!(state.output.contains_key("_locales/en/messages.json"));
    }
    assert_eq!(harness.drain_pushes(), [r#"{"type":"manifest"}"#]);
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn an_image_edit_records_a_resource_version() {
    let harness = start(&json!({}), |state| {
        state
            .public
            .insert("src/public/img/a.png".to_owned(), b"png".to_vec());
    })
    .await;
    harness.touch(&["src/public/img/a.png"]).await;
    harness.settle().await;
    assert_eq!(harness.log.entries(), ["inject"]);
    {
        let state = harness.files.state.lock().unwrap();
        let version = state.extras[0].resource_versions.get("/img/a.png");
        assert_eq!(version.map(String::len), Some(12));
    }
    harness.stop().await.unwrap();
}
