//! The typed shape of RDP packets: actor names, the requests this client sends, and the fields it
//! reads from replies and notifications.

use serde::{Deserialize, Serialize};
use serde_json::Value;

const ROOT_ACTOR: &str = "root";

/// The name of one RDP actor: the addressee (`to`) and sender (`from`) of every packet.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub(super) struct ActorId(String);

impl ActorId {
    /// An actor id from its wire text.
    pub(super) fn new(raw: impl Into<String>) -> Self {
        Self(raw.into())
    }

    /// The root actor every connection starts with.
    pub(super) fn root() -> Self {
        Self::new(ROOT_ACTOR)
    }
}

/// Correlates an `evaluateJSAsync` acknowledgement with its later `evaluationResult`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub(super) struct ResultId(Value);

/// The request types this client sends (the `type` of an outgoing packet).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum RequestKind {
    GetProcess,
    GetTarget,
    ListAddons,
    GetWatcher,
    WatchTargets,
    #[serde(rename = "evaluateJSAsync")]
    EvaluateJsAsync,
}

/// The target types a watcher is asked to announce.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(super) enum WatchedTargetType {
    Frame,
}

/// The packet types this client waits for (the `type` of an incoming packet); replies have none.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub(super) enum PacketKind {
    #[serde(rename = "evaluationResult")]
    EvaluationResult,
    #[serde(rename = "target-available-form")]
    TargetAvailable,
    #[serde(other)]
    Other,
}

/// The fields of an incoming packet this client reads; everything else is ignored.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct Packet {
    pub(super) from: Option<ActorId>,
    #[serde(rename = "type")]
    pub(super) kind: Option<PacketKind>,
    pub(super) target: Option<Target>,
    pub(super) process_descriptor: Option<ActorRef>,
    pub(super) process: Option<ConsoleHolder>,
    pub(super) frame: Option<ConsoleHolder>,
    pub(super) addons: Vec<Addon>,
    pub(super) actor: Option<ActorId>,
    pub(super) result: Option<Value>,
    #[serde(rename = "resultID")]
    pub(super) result_id: Option<ResultId>,
}

impl Packet {
    pub(super) fn is_from(&self, actor: &ActorId) -> bool {
        self.from.as_ref() == Some(actor)
    }

    pub(super) fn is_kind(&self, kind: PacketKind) -> bool {
        self.kind == Some(kind)
    }
}

/// A frame target announced by a watcher.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct Target {
    pub(super) url: Option<String>,
    pub(super) console_actor: Option<ActorId>,
}

/// A process or frame form that carries a console actor.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub(super) struct ConsoleHolder {
    pub(super) console_actor: Option<ActorId>,
}

/// A form that names one actor.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub(super) struct ActorRef {
    pub(super) actor: Option<ActorId>,
}

/// One entry of `listAddons`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub(super) struct Addon {
    pub(super) id: Option<String>,
    pub(super) actor: Option<ActorId>,
}
