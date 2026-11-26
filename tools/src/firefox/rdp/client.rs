//! A Firefox RDP session: request/reply correlation by actor, typed replies and the lookups every
//! RDP command shares (port discovery, tabs, add-ons, the add-on's watcher).

use std::collections::VecDeque;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::process::Command;
use tokio::time::{timeout_at, Instant};
use ytdl_dev_hot::driver::rdp::message::{
    encode_request, ActorId, Addon, EvaluateParams, FrameTarget, GetWatcherParams, NoParams,
    PacketKind, RequestKind, ResultId,
};

use super::replies::{AddonList, Tab, TabList, TargetReply, WatcherEvent};
use crate::firefox::framed::Framed;
use crate::firefox::{FirefoxError, Result};

pub(crate) const ADDON_ID: &str = "youtube-downloader@avi12.com";
const SKIP_PORTS: [u16; 2] = [2828, 9230];
const MIN_RDP_PORT: u16 = 1024;
pub(crate) const DEFAULT_REPLY_TIMEOUT: Duration = Duration::from_secs(5);
const LISTENING_PORTS_SCRIPT: &str = "$ff=Get-Process firefox -EA 0; Get-NetTCPConnection -State Listen -EA 0 | ?{ $_.OwningProcess -in $ff.Id } | Select-Object -ExpandProperty LocalPort";
/// The header every packet is routed by; the rest of it is read per request.
#[derive(Debug, Deserialize)]
struct Header {
    from: ActorId,
    #[serde(rename = "type")]
    kind: Option<PacketKind>,
    #[serde(rename = "resultID")]
    result_id: Option<ResultId>,
}

/// One packet from an actor.
#[derive(Debug, Clone)]
pub(crate) struct Message {
    pub(crate) from: ActorId,
    pub(crate) kind: Option<PacketKind>,
    result_id: Option<ResultId>,
    /// The whole packet, which commands print or parse further.
    pub(crate) body: Value,
}

impl Message {
    fn from_value(body: Value) -> Option<Self> {
        let Header {
            from,
            kind,
            result_id,
        } = Header::deserialize(&body).ok()?;
        Some(Self {
            from,
            kind,
            result_id,
            body,
        })
    }

    pub(crate) fn parse<T: DeserializeOwned>(&self) -> Result<T> {
        Ok(T::deserialize(&self.body)?)
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
        let greeting = rdp.wait_from(&ActorId::root(), reply_timeout).await?;
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
        actor: &ActorId,
        limit: Duration,
        matches: impl Fn(&Message) -> bool + Send,
    ) -> Result<Message> {
        let deadline = Instant::now() + limit;
        loop {
            let found = self
                .queue
                .iter()
                .position(|message| message.from == *actor && matches(message));
            if let Some(message) = found.and_then(|index| self.queue.remove(index)) {
                return Ok(message);
            }
            timeout_at(deadline, self.read_one())
                .await
                .map_err(|_| FirefoxError::Timeout(actor.to_string()))??;
        }
    }

    /// Waits for the next packet from `actor`.
    pub(crate) async fn wait_from(&mut self, actor: &ActorId, limit: Duration) -> Result<Message> {
        self.wait_matching(actor, limit, |_| true).await
    }

    /// Sends a request without waiting for its reply.
    pub(crate) async fn send<P: Serialize + Sync>(
        &mut self,
        actor: &ActorId,
        kind: RequestKind,
        params: &P,
    ) -> Result<()> {
        let packet = encode_request(actor, kind, params)?;
        self.framed.write(&packet).await
    }

    /// Sends a request and waits for the next packet from the same actor.
    pub(crate) async fn request<P: Serialize + Sync>(
        &mut self,
        actor: &ActorId,
        kind: RequestKind,
        params: &P,
    ) -> Result<Message> {
        self.send(actor, kind, params).await?;
        self.wait_from(actor, self.reply_timeout).await
    }

    /// Evaluates `text` in a console actor and returns the `evaluationResult` packet (or the
    /// reply itself when it carried no `resultID`).
    pub(crate) async fn evaluate(
        &mut self,
        console: &ActorId,
        text: &str,
        limit: Duration,
    ) -> Result<Message> {
        let params = EvaluateParams::new(text).not_eager();
        self.evaluate_with(console, params, limit).await
    }

    /// Like [`Self::evaluate`], awaiting the promise the text resolves to (top-level `await`).
    pub(crate) async fn evaluate_awaiting(
        &mut self,
        console: &ActorId,
        text: &str,
        limit: Duration,
    ) -> Result<Message> {
        let params = EvaluateParams::new(text).not_eager().awaiting();
        self.evaluate_with(console, params, limit).await
    }

    async fn evaluate_with(
        &mut self,
        console: &ActorId,
        params: EvaluateParams<'_>,
        limit: Duration,
    ) -> Result<Message> {
        let ack = self
            .request(console, RequestKind::EvaluateJsAsync, &params)
            .await?;
        let Some(result_id) = ack.result_id.clone() else {
            return Ok(ack);
        };
        self.wait_matching(console, limit, |message| {
            message.kind == Some(PacketKind::EvaluationResult)
                && message.result_id.as_ref() == Some(&result_id)
        })
        .await
    }

    pub(crate) async fn tabs(&mut self) -> Result<Vec<Tab>> {
        let reply = self
            .request(&ActorId::root(), RequestKind::ListTabs, &NoParams {})
            .await?;
        Ok(reply.parse::<TabList>()?.tabs)
    }

    pub(crate) async fn addons(&mut self) -> Result<Vec<Addon>> {
        let reply = self
            .request(&ActorId::root(), RequestKind::ListAddons, &NoParams {})
            .await?;
        Ok(reply.parse::<AddonList>()?.addons)
    }

    /// The actor of the first tab whose URL contains `url_part`.
    pub(crate) async fn find_tab_actor(&mut self, url_part: &str) -> Result<ActorId> {
        let tabs = self.tabs().await?;
        tabs.into_iter()
            .find(|tab| tab.url.as_deref().unwrap_or_default().contains(url_part))
            .and_then(|tab| tab.actor)
            .ok_or_else(|| FirefoxError::Failed(format!("no tab matching {url_part}")))
    }

    /// The `getTarget` reply of a tab actor, typed and raw.
    pub(crate) async fn target_of(&mut self, tab_actor: &ActorId) -> Result<(TargetReply, Value)> {
        let reply = self
            .request(tab_actor, RequestKind::GetTarget, &NoParams {})
            .await?;
        Ok((reply.parse()?, reply.body))
    }

    /// The watcher actor of the extension.
    pub(crate) async fn addon_watcher(&mut self) -> Result<ActorId> {
        let addons = self.addons().await?;
        let addon_actor = addons
            .into_iter()
            .find(|addon| addon.id.as_deref() == Some(ADDON_ID))
            .and_then(|addon| addon.actor)
            .ok_or_else(|| FirefoxError::Failed("addon not found".into()))?;
        let reply = self
            .request(
                &addon_actor,
                RequestKind::GetWatcher,
                &GetWatcherParams::default(),
            )
            .await?;
        let watcher = reply.parse::<WatcherEvent>()?.actor;
        watcher.ok_or_else(|| FirefoxError::Failed("no watcher".into()))
    }

    /// Collects the frame targets a watcher announces until `total` passes or no packet arrives
    /// within `per_wait`.
    pub(crate) async fn collect_targets(
        &mut self,
        watcher: &ActorId,
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
            let is_form = event.kind == Some(PacketKind::TargetAvailable);
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
