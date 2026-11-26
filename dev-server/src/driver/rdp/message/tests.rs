use serde_json::json;

use super::*;
use crate::driver::rdp::PacketDecoder;

fn sent<P: Serialize>(kind: RequestKind, params: &P) -> Result<Vec<Value>> {
    PacketDecoder::default().push(&encode_request(&ActorId::new("a1"), kind, params)?)
}

#[test]
fn requests_keep_their_wire_shape() -> Result<()> {
    assert_eq!(
        sent(RequestKind::GetProcess, &GetProcessParams::PARENT)?,
        [json!({"to":"a1","type":"getProcess","id":0})]
    );
    assert_eq!(
        sent(
            RequestKind::GetWatcher,
            &GetWatcherParams::SWITCHING_TARGETS
        )?,
        [json!({"to":"a1","type":"getWatcher","isServerTargetSwitchingEnabled":true})]
    );
    assert_eq!(
        sent(RequestKind::GetWatcher, &GetWatcherParams::default())?,
        [json!({"to":"a1","type":"getWatcher"})]
    );
    assert_eq!(
        sent(RequestKind::WatchTargets, &WatchTargetsParams::FRAMES)?,
        [json!({"to":"a1","type":"watchTargets","targetType":"frame"})]
    );
    let evaluation = EvaluateParams::new("x").not_eager().awaiting();
    assert_eq!(
        sent(RequestKind::EvaluateJsAsync, &evaluation)?,
        [json!({
            "to":"a1","type":"evaluateJSAsync","text":"x","eager":false,"mapped":{"await":true}
        })]
    );
    Ok(())
}

#[test]
fn resource_types_use_the_wire_names() -> Result<()> {
    let kinds = [ResourceType::ConsoleMessage, ResourceType::ErrorMessage];
    assert_eq!(
        serde_json::to_value(kinds)?,
        json!(["console-message", "error-message"])
    );
    let unknown: ResourceType = serde_json::from_value(json!("network-event"))?;
    assert_eq!(unknown, ResourceType::Other);
    Ok(())
}

#[test]
fn an_addon_reply_keeps_known_fields_and_ignores_the_rest() -> Result<()> {
    let packet: Packet = serde_json::from_value(json!({
        "from": "root",
        "addons": [{"actor": "a", "id": "x@y", "isSystem": false,
            "manifestURL": "moz-extension://u/manifest.json", "temporarilyInstalled": true}]
    }))?;
    let manifest = packet
        .addons
        .first()
        .and_then(|addon| addon.manifest_url.as_deref());
    assert_eq!(manifest, Some("moz-extension://u/manifest.json"));
    Ok(())
}

#[test]
fn the_wake_script_quotes_the_id() {
    assert_eq!(
        wake_background_script("a@b"),
        "WebExtensionPolicy.getByID(\"a@b\")?.extension.wakeupBackground()"
    );
}
