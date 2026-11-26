//! The replies only these commands read; the forms shared with the sidecar live in its
//! `driver::rdp::message`. Firefox sends more than is read here, so unknown fields are ignored.

use serde::Deserialize;
use serde_json::Value;
use ytdl_dev_hot::driver::rdp::message::{ActorForm, ActorId, Addon, FrameTarget, PacketKind};

/// One entry of `listTabs`.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct Tab {
    pub(crate) actor: Option<ActorId>,
    pub(crate) title: Option<String>,
    pub(crate) url: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct TabList {
    pub(crate) tabs: Vec<Tab>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct AddonList {
    pub(crate) addons: Vec<Addon>,
}

/// The reply to `getTarget`.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct TargetReply {
    pub(crate) frame: Option<ActorForm>,
    pub(crate) process: Option<ActorForm>,
    pub(crate) console_actor: Option<ActorId>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct WatcherEvent {
    #[serde(rename = "type")]
    pub(crate) kind: Option<PacketKind>,
    pub(crate) target: Option<FrameTarget>,
    pub(crate) actor: Option<ActorId>,
}

/// The reply to `getProcess`.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct ProcessReply {
    pub(crate) process_descriptor: Option<ActorForm>,
}

/// An `evaluationResult`. Both fields are arbitrary page data.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct EvaluationReply {
    pub(crate) result: Option<Value>,
    pub(crate) exception_message: Option<Value>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn an_addon_carries_its_manifest_url() {
        let list: AddonList = serde_json::from_value(json!({
            "addons": [{"actor": "a1", "id": "x@y", "manifestURL": "moz-extension://u/manifest.json"}]
        }))
        .unwrap();
        let addon = list.addons.first().unwrap();
        assert_eq!(
            addon.manifest_url.as_deref(),
            Some("moz-extension://u/manifest.json")
        );
    }

    #[test]
    fn a_process_reply_names_its_descriptor_and_a_target_its_console() {
        let process: ProcessReply =
            serde_json::from_value(json!({"processDescriptor": {"actor": "p1"}})).unwrap();
        assert_eq!(
            process.process_descriptor.unwrap().actor,
            Some(ActorId::new("p1"))
        );
        let target: TargetReply =
            serde_json::from_value(json!({"process": {"consoleActor": "c1"}})).unwrap();
        assert_eq!(
            target.process.unwrap().console_actor,
            Some(ActorId::new("c1"))
        );
    }
}
