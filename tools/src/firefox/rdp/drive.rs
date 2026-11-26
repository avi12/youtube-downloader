//! `rdp-drive <port> <action>`: the quick RDP probes (add-ons, tabs, eval, navigation, the
//! background page of the extension and the popup measurement).

use std::time::Duration;

use clap::{Args, Subcommand};
use serde::Serialize;
use serde_json::{json, Value};
use ytdl_dev_hot::driver::rdp::message::{ActorId, FrameTarget, RequestKind, WatchTargetsParams};

use super::client::{truncate, Rdp};
use super::replies::EvaluationReply;
use crate::firefox::pause;
use crate::firefox::{FirefoxError, Result};
use crate::port::parse_port_number;

const REPLY_TIMEOUT: Duration = Duration::from_secs(20);
const EVAL_TIMEOUT: Duration = Duration::from_secs(60);
const POPUP_EVAL_TIMEOUT: Duration = Duration::from_secs(30);
const TARGETS_TOTAL: Duration = Duration::from_secs(8);
const TARGETS_PER_WAIT: Duration = Duration::from_secs(3);
const INITIAL_TARGETS_DRAIN: Duration = Duration::from_secs(4);
const POPUP_TARGETS_DRAIN: Duration = Duration::from_secs(3);
const MEASURE_SETTLE: Duration = Duration::from_millis(1800);
const ADDON_URL_CHARS: usize = 80;
const TAB_TITLE_CHARS: usize = 50;
const TAB_URL_CHARS: usize = 70;
const TARGET_URL_CHARS: usize = 60;
const TARGET_PREVIEW_CHARS: usize = 300;
const EVAL_OUTPUT_CHARS: usize = 4000;
const NAV_OUTPUT_CHARS: usize = 200;
const FULL_OUTPUT_CHARS: usize = 2000;
const OPEN_POPUP_SCRIPT: &str = "(browser.action||browser.browserAction).openPopup()";
const READ_MEASURE_SCRIPT: &str = "globalThis.__pm";
/// Runs inside the popup page: opens the settings picker and records the dropdown's geometry.
const POPUP_MEASURE_SCRIPT: &str = "globalThis.__pm='run';(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const t=[...document.querySelectorAll('button,[role=tab]')].find(b=>/settings/i.test((b.textContent||'')+(b.getAttribute('aria-label')||'')));t&&t.click();await s(400);const tr=document.querySelector('.set-picker-btn');tr&&tr.click();await s(500);const l=document.querySelector('.dropdown-list');if(!l){globalThis.__pm=JSON.stringify({error:'no list',innerHeight:window.innerHeight});return;}const cs=getComputedStyle(l);const r=l.getBoundingClientRect();globalThis.__pm=JSON.stringify({innerHeight:window.innerHeight,docScrollH:document.documentElement.scrollHeight,maxBlockSize:cs.maxBlockSize,overflowY:cs.overflowY,clientHeight:l.clientHeight,scrollHeight:l.scrollHeight,rectTop:Math.round(r.top),rectBottom:Math.round(r.bottom),rectHeight:Math.round(r.height),isScrollable:l.scrollHeight>l.clientHeight,options:l.querySelectorAll('[role=option]').length});})();'kicked'";

/// Arguments of `rdp-drive`.
#[derive(Debug, Args)]
pub(crate) struct DriveArgs {
    /// The debugger port of the Firefox to drive
    #[arg(value_parser = parse_port_number)]
    port: u16,
    #[command(subcommand)]
    action: Action,
}

#[derive(Debug, Subcommand)]
enum Action {
    /// Lists the installed add-ons
    Addons,
    /// Lists the open tabs
    Tabs,
    /// Evaluates JavaScript in the first tab whose URL contains the text
    Eval {
        /// Text the tab's URL must contain
        url_part: String,
        /// JavaScript to evaluate
        expression: String,
    },
    /// Navigates the first tab whose URL contains the text
    Nav {
        /// Text the tab's URL must contain
        url_part: String,
        /// Where to go
        url: String,
    },
    /// Evaluates JavaScript in the extension's background page
    AddonEval {
        /// JavaScript to evaluate
        expression: String,
    },
    /// Opens the popup and prints the geometry of its settings dropdown
    PopupMeasure,
}

#[derive(Debug, Serialize)]
struct AddonSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    temp: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

#[derive(Debug, Serialize)]
struct TabSummary {
    #[serde(skip_serializing_if = "Option::is_none")]
    actor: Option<ActorId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

/// The parameters of `navigateTo`.
#[derive(Debug, Serialize)]
struct NavigateParams<'url> {
    url: &'url str,
}

fn preview(text: Option<String>, limit: usize) -> Option<String> {
    text.map(|inner| truncate(&inner, limit))
}

/// What an evaluation printed: its `result`, else its `exception`, else the whole packet.
fn evaluation_summary(body: &Value) -> &Value {
    body.get("result")
        .or_else(|| body.get("exception"))
        .unwrap_or(body)
}

/// The console actor of the background page, found among the add-on's frame targets.
fn background_console(targets: &[FrameTarget]) -> Option<ActorId> {
    let url_of = |target: &FrameTarget| target.url.clone().unwrap_or_default();
    let background = targets
        .iter()
        .find(|target| url_of(target).contains("background"));
    let extension = targets
        .iter()
        .find(|target| url_of(target).starts_with("moz-extension:"));
    background.or(extension)?.console_actor.clone()
}

fn target_urls(targets: &[FrameTarget], limit: usize) -> String {
    let urls: Vec<String> = targets
        .iter()
        .filter_map(|target| target.url.as_deref())
        .map(|url| truncate(url, limit))
        .collect();
    json!(urls).to_string()
}

async fn watch_addon_frames(rdp: &mut Rdp) -> Result<ActorId> {
    let watcher = rdp.addon_watcher().await?;
    rdp.send(
        &watcher,
        RequestKind::WatchTargets,
        &WatchTargetsParams::FRAMES,
    )
    .await?;
    Ok(watcher)
}

async fn evaluate_value(
    rdp: &mut Rdp,
    console: &ActorId,
    text: &str,
    limit: Duration,
) -> Result<Option<Value>> {
    let result = rdp.evaluate(console, text, limit).await?;
    Ok(result.parse::<EvaluationReply>()?.result)
}

pub(in crate::firefox) async fn run(args: DriveArgs) -> Result<()> {
    let mut rdp = Rdp::connect(args.port, REPLY_TIMEOUT).await?;
    match args.action {
        Action::Addons => addons(&mut rdp).await,
        Action::Tabs => tabs(&mut rdp).await,
        Action::Eval {
            url_part,
            expression,
        } => eval(&mut rdp, &url_part, &expression).await,
        Action::Nav { url_part, url } => navigate(&mut rdp, &url_part, &url).await,
        Action::AddonEval { expression } => addon_eval(&mut rdp, &expression).await,
        Action::PopupMeasure => popup_measure(&mut rdp).await,
    }
}

async fn addons(rdp: &mut Rdp) -> Result<()> {
    let summaries: Vec<AddonSummary> = rdp
        .addons()
        .await?
        .into_iter()
        .map(|addon| AddonSummary {
            id: addon.id,
            temp: addon.temporarily_installed,
            url: preview(addon.url, ADDON_URL_CHARS),
        })
        .collect();
    println!("{}", serde_json::to_string_pretty(&summaries)?);
    Ok(())
}

async fn tabs(rdp: &mut Rdp) -> Result<()> {
    let summaries: Vec<TabSummary> = rdp
        .tabs()
        .await?
        .into_iter()
        .map(|tab| TabSummary {
            actor: tab.actor,
            title: preview(tab.title, TAB_TITLE_CHARS),
            url: preview(tab.url, TAB_URL_CHARS),
        })
        .collect();
    println!("{}", serde_json::to_string_pretty(&summaries)?);
    Ok(())
}

async fn eval(rdp: &mut Rdp, url_part: &str, expression: &str) -> Result<()> {
    let tab_actor = rdp.find_tab_actor(url_part).await?;
    let (target, body) = rdp.target_of(&tab_actor).await?;
    let console = target
        .frame
        .and_then(|frame| frame.console_actor)
        .ok_or_else(|| {
            FirefoxError::Failed(format!(
                "no consoleActor in {}",
                truncate(&body.to_string(), TARGET_PREVIEW_CHARS)
            ))
        })?;
    let result = rdp.evaluate(&console, expression, EVAL_TIMEOUT).await?;
    let summary = evaluation_summary(&result.body).to_string();
    println!("{}", truncate(&summary, EVAL_OUTPUT_CHARS));
    Ok(())
}

async fn navigate(rdp: &mut Rdp, url_part: &str, url: &str) -> Result<()> {
    let tab_actor = rdp.find_tab_actor(url_part).await?;
    let (target, _) = rdp.target_of(&tab_actor).await?;
    let frame_actor = target
        .frame
        .and_then(|frame| frame.actor)
        .ok_or_else(|| FirefoxError::Failed("the tab has no frame actor".into()))?;
    let reply = rdp
        .request(
            &frame_actor,
            RequestKind::NavigateTo,
            &NavigateParams { url },
        )
        .await?;
    println!(
        "nav result: {}",
        truncate(&reply.body.to_string(), NAV_OUTPUT_CHARS)
    );
    Ok(())
}

async fn addon_eval(rdp: &mut Rdp, expression: &str) -> Result<()> {
    let watcher = watch_addon_frames(rdp).await?;
    let targets = rdp
        .collect_targets(&watcher, TARGETS_TOTAL, TARGETS_PER_WAIT)
        .await;
    println!("targets: {}", target_urls(&targets, ADDON_URL_CHARS));
    let console = background_console(&targets)
        .ok_or_else(|| FirefoxError::Failed("no background target found".into()))?;
    let result = rdp.evaluate(&console, expression, EVAL_TIMEOUT).await?;
    println!(
        "FULL: {}",
        truncate(&result.body.to_string(), FULL_OUTPUT_CHARS)
    );
    Ok(())
}

async fn popup_measure(rdp: &mut Rdp) -> Result<()> {
    let watcher = watch_addon_frames(rdp).await?;
    let mut targets = rdp
        .collect_targets(&watcher, INITIAL_TARGETS_DRAIN, INITIAL_TARGETS_DRAIN)
        .await;
    println!(
        "initial targets: {}",
        target_urls(&targets, TARGET_URL_CHARS)
    );
    let background = background_console(&targets)
        .ok_or_else(|| FirefoxError::Failed("no background target".into()))?;
    let opened = evaluate_value(rdp, &background, OPEN_POPUP_SCRIPT, POPUP_EVAL_TIMEOUT).await?;
    println!("openPopup: {}", opened.unwrap_or(Value::Null));
    targets.extend(
        rdp.collect_targets(&watcher, POPUP_TARGETS_DRAIN, POPUP_TARGETS_DRAIN)
            .await,
    );
    let popup = targets
        .iter()
        .find(|target| {
            target
                .url
                .as_deref()
                .unwrap_or_default()
                .contains("popup.html")
        })
        .and_then(|target| target.console_actor.clone())
        .ok_or_else(|| {
            FirefoxError::Failed(format!(
                "popup target not found; targets: {}",
                target_urls(&targets, TARGET_URL_CHARS)
            ))
        })?;
    evaluate_value(rdp, &popup, POPUP_MEASURE_SCRIPT, POPUP_EVAL_TIMEOUT).await?;
    pause(MEASURE_SETTLE).await;
    let measured = evaluate_value(rdp, &popup, READ_MEASURE_SCRIPT, POPUP_EVAL_TIMEOUT).await?;
    println!("MEASURE: {}", measured.unwrap_or(Value::Null));
    Ok(())
}

#[cfg(test)]
mod tests;
