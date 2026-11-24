//! The typed shape of the RDP replies this tool reads; everything else is ignored.

use serde::Deserialize;

/// One entry of `listTabs`.
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct Tab {
    pub(crate) actor: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) url: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct TabList {
    pub(crate) tabs: Vec<Tab>,
}

/// One entry of `listAddons`.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Addon {
    pub(crate) actor: Option<String>,
    pub(crate) id: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) url: Option<String>,
    pub(crate) temporarily_installed: Option<bool>,
    #[serde(rename = "manifestURL")]
    pub(crate) manifest_url: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct AddonList {
    pub(crate) addons: Vec<Addon>,
}

/// A form that carries console and frame actors.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct Frame {
    pub(crate) actor: Option<String>,
    pub(crate) console_actor: Option<String>,
}

/// The reply to `getTarget`.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct TargetReply {
    pub(crate) frame: Option<Frame>,
    pub(crate) process: Option<Frame>,
    pub(crate) console_actor: Option<String>,
}

/// A frame target announced by a watcher.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct FrameTarget {
    pub(crate) url: Option<String>,
    pub(crate) console_actor: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
pub(crate) struct WatcherEvent {
    #[serde(rename = "type")]
    pub(crate) kind: Option<String>,
    pub(crate) target: Option<FrameTarget>,
    pub(crate) actor: Option<String>,
}

/// The reply to `getProcess`.
#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(crate) struct ProcessReply {
    pub(crate) process_descriptor: Option<Frame>,
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
            process.process_descriptor.unwrap().actor.as_deref(),
            Some("p1")
        );
        let target: TargetReply =
            serde_json::from_value(json!({"process": {"consoleActor": "c1"}})).unwrap();
        assert_eq!(target.process.unwrap().console_actor.as_deref(), Some("c1"));
    }
}
