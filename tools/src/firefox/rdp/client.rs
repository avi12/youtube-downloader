//! A Firefox RDP session: request/reply correlation by actor, typed replies and the lookups every
//! RDP command shares (port discovery, tabs, add-ons, the add-on's watcher).

use std::collections::VecDeque;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tokio::process::Command;
use tokio::time::{timeout_at, Instant};

use crate::firefox::framed::Framed;
use crate::firefox::rdp::replies::{
    Addon, AddonList, FrameTarget, TabList, TargetReply, WatcherEvent,
};
use crate::firefox::{FirefoxError, Result};

pub(crate) const ROOT_ACTOR: &str = "root";
pub(crate) const ADDON_ID: &str = "youtube-downloader@avi12.com";
const SKIP_PORTS: [u16; 2] = [2828, 9230];
const MIN_RDP_PORT: u16 = 1024;
pub(crate) const DEFAULT_REPLY_TIMEOUT: Duration = Duration::from_secs(5);
const LISTENING_PORTS_SCRIPT: &str = "$ff=Get-Process firefox -EA 0; Get-NetTCPConnection -State Listen -EA 0 | ?{ $_.OwningProcess -in $ff.Id } | Select-Object -ExpandProperty LocalPort";
pub(crate) const TARGET_AVAILABLE_FORM: &str = "target-available-form";
const EVALUATION_RESULT: &str = "evaluationResult";

/// The request types sent to actors (the `type` of an outgoing packet).
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RequestKind {
    ListTabs,
    ListAddons,
    ListProcesses,
    GetProcess,
    GetTarget,
    GetWatcher,
    WatchTargets,
    WatchResources,
    NavigateTo,
    #[serde(rename = "evaluateJSAsync")]
    EvaluateJsAsync,
}

/// One packet from an actor.
#[derive(Debug, Clone)]
pub(crate) struct Message {
    pub(crate) from: String,
    pub(crate) body: Value,
}

impl Message {
    fn from_value(body: Value) -> Option<Self> {
        let from = body.get("from")?.as_str()?.to_owned();
        Some(Self { from, body })
    }

    pub(crate) fn parse<T: DeserializeOwned>(&self) -> Result<T> {
        Ok(T::deserialize(&self.body)?)
    }

    pub(crate) fn type_is(&self, expected: &str) -> bool {
        self.body.get("type").and_then(Value::as_str) == Some(expected)
    }
}

/// The first `limit` characters of `text`.
pub(crate) fn truncate(text: &str, limit: usize) -> String {
    text.chars().take(limit).collect()
}

/// The first port of `listening` (whitespace separated) that can be Firefox's RDP server.
fn pick_rdp_port(listening: &str) -> Option<u16> {
    listening
        .split_whitespace()
        .filter_map(|word| word.parse::<u16>().ok())
        .find(|port| !SKIP_PORTS.contains(port) && *port > MIN_RDP_PORT)
}

/// Finds the debugger port among the ports Firefox listens on.
pub(crate) async fn find_rdp_port() -> Result<u16> {
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", LISTENING_PORTS_SCRIPT])
        .output()
        .await?;
    let listening = String::from_utf8_lossy(&output.stdout);
    pick_rdp_port(&listening).ok_or_else(|| {
        FirefoxError::Failed(format!(
            "No RDP port found. Firefox ports: {}",
            listening.split_whitespace().collect::<Vec<_>>().join(", ")
        ))
    })
}

/// One RDP connection; packets nobody asked for yet wait in a queue.
#[derive(Debug)]
pub(crate) struct Rdp {
    framed: Framed,
    queue: VecDeque<Message>,
    reply_timeout: Duration,
    pub(crate) greeting: Value,
}

impl Rdp {
    /// Connects and waits for the root actor's greeting.
    pub(crate) async fn connect(port: u16, reply_timeout: Duration) -> Result<Self> {
        let mut rdp = Self {
            framed: Framed::connect(port).await?,
            queue: VecDeque::new(),
            reply_timeout,
            greeting: Value::Null,
        };
        let greeting = rdp.wait_from(ROOT_ACTOR, reply_timeout).await?;
        rdp.greeting = greeting.body;
        Ok(rdp)
    }

    async fn read_one(&mut self) -> Result<()> {
        let body = self.framed.recv().await?;
        self.queue.extend(Message::from_value(body));
        Ok(())
    }

    /// The next packet from any actor, or `None` when `limit` passes first.
    pub(crate) async fn next_message(&mut self, limit: Duration) -> Result<Option<Message>> {
        let deadline = Instant::now() + limit;
        loop {
            if let Some(message) = self.queue.pop_front() {
                return Ok(Some(message));
            }
            let Ok(read) = timeout_at(deadline, self.read_one()).await else {
                return Ok(None);
            };
            read?;
        }
    }

    /// The first packet from `actor` that `matches`, within `limit`.
    pub(crate) async fn wait_matching(
        &mut self,
        actor: &str,
        limit: Duration,
        matches: impl Fn(&Message) -> bool + Send,
    ) -> Result<Message> {
        let deadline = Instant::now() + limit;
        loop {
            let found = self
                .queue
                .iter()
                .position(|message| message.from == actor && matches(message));
            if let Some(message) = found.and_then(|index| self.queue.remove(index)) {
                return Ok(message);
            }
            timeout_at(deadline, self.read_one())
                .await
                .map_err(|_| FirefoxError::Timeout(actor.to_owned()))??;
        }
    }

    /// Waits for the next packet from `actor`.
    pub(crate) async fn wait_from(&mut self, actor: &str, limit: Duration) -> Result<Message> {
        self.wait_matching(actor, limit, |_| true).await
    }

    /// Sends a request without waiting for its reply.
    pub(crate) async fn send(
        &mut self,
        actor: &str,
        kind: RequestKind,
        extra: Value,
    ) -> Result<()> {
        let mut packet = Map::new();
        packet.insert("to".into(), json!(actor));
        packet.insert("type".into(), json!(kind));
        if let Value::Object(fields) = extra {
            packet.extend(fields);
        }
        self.framed.send(&Value::Object(packet)).await
    }

    /// Sends a request and waits for the next packet from the same actor.
    pub(crate) async fn request(
        &mut self,
        actor: &str,
        kind: RequestKind,
        extra: Value,
    ) -> Result<Message> {
        self.send(actor, kind, extra).await?;
        self.wait_from(actor, self.reply_timeout).await
    }

    /// Evaluates `text` in a console actor and returns the `evaluationResult` packet (or the
    /// reply itself when it carried no `resultID`).
    pub(crate) async fn evaluate(
        &mut self,
        console: &str,
        text: &str,
        limit: Duration,
    ) -> Result<Message> {
        let body = json!({"text": text, "eager": false});
        self.evaluate_body(console, body, limit).await
    }

    /// Like [`Self::evaluate`], awaiting the promise the text resolves to (top-level `await`).
    pub(crate) async fn evaluate_awaiting(
        &mut self,
        console: &str,
        text: &str,
        limit: Duration,
    ) -> Result<Message> {
        let body = json!({"text": text, "eager": false, "mapped": {"await": true}});
        self.evaluate_body(console, body, limit).await
    }

    async fn evaluate_body(
        &mut self,
        console: &str,
        body: Value,
        limit: Duration,
    ) -> Result<Message> {
        let ack = self
            .request(console, RequestKind::EvaluateJsAsync, body)
            .await?;
        let Some(result_id) = ack.body.get("resultID").cloned() else {
            return Ok(ack);
        };
        self.wait_matching(console, limit, |message| {
            message.type_is(EVALUATION_RESULT) && message.body.get("resultID") == Some(&result_id)
        })
        .await
    }

    pub(crate) async fn tabs(&mut self) -> Result<Vec<crate::firefox::rdp::replies::Tab>> {
        let reply = self
            .request(ROOT_ACTOR, RequestKind::ListTabs, json!({}))
            .await?;
        Ok(reply.parse::<TabList>()?.tabs)
    }

    pub(crate) async fn addons(&mut self) -> Result<Vec<Addon>> {
        let reply = self
            .request(ROOT_ACTOR, RequestKind::ListAddons, json!({}))
            .await?;
        Ok(reply.parse::<AddonList>()?.addons)
    }

    /// The actor of the first tab whose URL contains `url_part`.
    pub(crate) async fn find_tab_actor(&mut self, url_part: &str) -> Result<String> {
        let tabs = self.tabs().await?;
        tabs.into_iter()
            .find(|tab| tab.url.as_deref().unwrap_or_default().contains(url_part))
            .and_then(|tab| tab.actor)
            .ok_or_else(|| FirefoxError::Failed(format!("no tab matching {url_part}")))
    }

    /// The `getTarget` reply of a tab actor, typed and raw.
    pub(crate) async fn target_of(&mut self, tab_actor: &str) -> Result<(TargetReply, Value)> {
        let reply = self
            .request(tab_actor, RequestKind::GetTarget, json!({}))
            .await?;
        Ok((reply.parse()?, reply.body))
    }

    /// The watcher actor of the extension.
    pub(crate) async fn addon_watcher(&mut self) -> Result<String> {
        let addons = self.addons().await?;
        let addon_actor = addons
            .into_iter()
            .find(|addon| addon.id.as_deref() == Some(ADDON_ID))
            .and_then(|addon| addon.actor)
            .ok_or_else(|| FirefoxError::Failed("addon not found".into()))?;
        let reply = self
            .request(&addon_actor, RequestKind::GetWatcher, json!({}))
            .await?;
        let watcher = reply.parse::<WatcherEvent>()?.actor;
        watcher.ok_or_else(|| FirefoxError::Failed("no watcher".into()))
    }

    /// Collects the frame targets a watcher announces until `total` passes or no packet arrives
    /// within `per_wait`.
    pub(crate) async fn collect_targets(
        &mut self,
        watcher: &str,
        total: Duration,
        per_wait: Duration,
    ) -> Vec<FrameTarget> {
        let deadline = Instant::now() + total;
        let mut targets = Vec::new();
        while Instant::now() < deadline {
            let Ok(message) = self.wait_from(watcher, per_wait).await else {
                break;
            };
            let Ok(event) = message.parse::<WatcherEvent>() else {
                continue;
            };
            let is_form = event.kind.as_deref() == Some(TARGET_AVAILABLE_FORM);
            targets.extend(
                event
                    .target
                    .filter(|target| is_form && target.console_actor.is_some()),
            );
        }
        targets
    }
}

#[cfg(test)]
mod tests;
