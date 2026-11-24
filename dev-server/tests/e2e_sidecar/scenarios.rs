//! What the sidecar does for each kind of edit, asserted on the requests it sent and the pushes it
//! made.

use std::sync::atomic::Ordering;

use crate::eventually;
use crate::sidecar::launch;

fn only_injections(calls: &[String]) -> bool {
    calls.iter().all(|call| call == "injectHmr")
}

#[tokio::test]
async fn a_public_locale_edit_never_builds() {
    let (scenario, sidecar, hmr) = launch().await;
    let messages = "src/public/_locales/en/messages.json";
    scenario.project.write(
        messages,
        r#"{"hello":{"message":"new"},"bye":{"message":"bye"}}"#,
    );
    let push = hmr.message_with(r#""overlay":{"#).await;
    assert_eq!(push["manifest"]["overlay"]["hello"]["message"], "new");
    assert_eq!(push["manifest"]["overlay"]["bye"]["message"], "bye");
    assert!(only_injections(&sidecar.calls()), "no build, no reload");
    let extras = scenario.project.hmr_manifest();
    assert_eq!(extras["overlay"]["hello"]["message"], "new");
    assert!(scenario
        .project
        .read_output("_locales/en/messages.json")
        .contains("bye"));
    assert!(sidecar.shutdown().await.success());
}

#[tokio::test]
async fn an_image_edit_publishes_a_resource_version() {
    let (scenario, sidecar, hmr) = launch().await;
    scenario.project.write("src/public/img/a.png", "png-v2");
    let push = hmr
        .message_with(r#""resourceVersions":{"/img/a.png""#)
        .await;
    let version = push["manifest"]["resourceVersions"]["/img/a.png"]
        .as_str()
        .unwrap();
    assert_eq!(version.len(), 12);
    assert_eq!(scenario.project.read_output("img/a.png"), "png-v2");
    assert!(only_injections(&sidecar.calls()));
    assert!(sidecar.shutdown().await.success());
}

#[tokio::test]
async fn an_env_edit_builds_and_leaves_the_diff_to_the_launcher() {
    let (scenario, sidecar, hmr) = launch().await;
    let manifests_before = hmr.all().len();
    scenario.project.write(".env", "VITE_A=2");
    sidecar.saw("buildExtension").await;
    eventually("the manifest push after the build", || {
        (hmr.all().len() > manifests_before).then_some(())
    })
    .await;
    let calls = sidecar.calls();
    let position = |name: &str| calls.iter().position(|call| call == name).unwrap();
    assert!(position("refreshEnv") < position("buildExtension"));
    assert!(position("buildExtension") < position("rebuildHmr"));
    sidecar.saw("reloadExtension").await;
    assert!(scenario.browser.calls.lock().unwrap().is_empty());
    assert!(sidecar.shutdown().await.success());
}

#[tokio::test]
async fn a_script_change_is_handed_to_the_launcher() {
    let (scenario, sidecar, hmr) = launch().await;
    scenario
        .is_build_bumping_scripts
        .store(true, Ordering::SeqCst);
    scenario
        .project
        .write("src/lib/a.ts", "export const a = 2;");
    sidecar.saw("reloadExtension").await;
    assert_eq!(
        sidecar
            .calls()
            .into_iter()
            .find(|call| call.starts_with("reloadExtension"))
            .as_deref(),
        Some("reloadExtension background=true mainWorld=true")
    );
    assert!(scenario.browser.calls.lock().unwrap().is_empty());
    let imminent = hmr.message_with(r#""type":"reload-imminent""#).await;
    assert_eq!(imminent["type"], "reload-imminent");
    assert!(sidecar.shutdown().await.success());
}

#[tokio::test]
async fn an_install_rebuilds_only_when_the_lockfile_changed() {
    let (scenario, sidecar, hmr) = launch().await;
    scenario
        .project
        .write_base("node_modules/.modules.yaml", "installed again");
    scenario
        .project
        .write("src/public/img/a.png", "png-sentinel");
    hmr.message_with(r#""resourceVersions":{"/img/a.png""#)
        .await;
    assert_eq!(
        sidecar.count("buildExtension"),
        0,
        "same lockfile: a no-op install"
    );

    scenario
        .project
        .write_base("node_modules/.pnpm/lock.yaml", "lock-v2");
    scenario
        .project
        .write_base("node_modules/.modules.yaml", "installed once more");
    sidecar.saw("buildExtension").await;
    assert!(sidecar.shutdown().await.success());
}

#[tokio::test]
async fn the_shutdown_notification_exits_cleanly() {
    let (_scenario, sidecar, _hmr) = launch().await;
    assert!(sidecar.shutdown().await.success());
}
