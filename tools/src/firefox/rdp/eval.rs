//! `rdp-list` and `rdp-eval`: list the targets of the running Firefox, evaluate in one tab.

use std::time::Duration;

use clap::Args;
use serde::Deserialize;
use serde_json::json;

use super::client::{find_rdp_port, truncate, Rdp, RequestKind, DEFAULT_REPLY_TIMEOUT, ROOT_ACTOR};
use crate::firefox::{FirefoxError, Result};

const EVAL_TIMEOUT: Duration = Duration::from_secs(30);
const TARGET_PREVIEW_CHARS: usize = 500;
const UNKNOWN: &str = "?";

/// Arguments of `rdp-eval`.
#[derive(Debug, Args)]
pub(crate) struct EvalArgs {
    /// Text the tab's URL must contain
    url_part: String,
    /// JavaScript to evaluate in the tab
    expression: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct ProcessList {
    processes: Vec<ProcessEntry>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct ProcessEntry {
    actor: Option<String>,
    id: Option<u64>,
    parent: Option<bool>,
}

fn or_unknown(text: Option<&str>) -> &str {
    text.unwrap_or(UNKNOWN)
}

fn display_or_unknown(value: Option<impl ToString>) -> String {
    value.map_or_else(|| UNKNOWN.to_owned(), |inner| inner.to_string())
}

pub(in crate::firefox) async fn list() -> Result<()> {
    let port = find_rdp_port().await?;
    println!("Using RDP port: {port}");
    let mut rdp = Rdp::connect(port, DEFAULT_REPLY_TIMEOUT).await?;
    println!("Greeting: {}", rdp.greeting);
    let tabs = rdp
        .request(ROOT_ACTOR, RequestKind::ListTabs, json!({}))
        .await?;
    println!("listTabs raw: {}", tabs.body);
    let addons = rdp.addons().await?;
    let processes = rdp
        .request(ROOT_ACTOR, RequestKind::ListProcesses, json!({}))
        .await?
        .parse::<ProcessList>()?;

    println!("\n== Tabs ==");
    for tab in tabs.parse::<super::replies::TabList>()?.tabs {
        println!(
            "  {} | {} | {}",
            or_unknown(tab.actor.as_deref()),
            or_unknown(tab.url.as_deref()),
            or_unknown(tab.title.as_deref())
        );
    }
    println!("\n== Addons (extensions) ==");
    for addon in addons {
        println!(
            "  {} | {} | {} | {}",
            or_unknown(addon.actor.as_deref()),
            or_unknown(addon.id.as_deref()),
            or_unknown(addon.name.as_deref()),
            addon.url.as_deref().unwrap_or_default()
        );
    }
    println!("\n== Processes ==");
    for process in processes.processes {
        println!(
            "  {} | pid={} | parent={}",
            or_unknown(process.actor.as_deref()),
            display_or_unknown(process.id),
            display_or_unknown(process.parent)
        );
    }
    Ok(())
}

pub(in crate::firefox) async fn run(args: EvalArgs) -> Result<()> {
    let port = find_rdp_port().await?;
    let mut rdp = Rdp::connect(port, DEFAULT_REPLY_TIMEOUT).await?;
    let tab_actor = rdp.find_tab_actor(&args.url_part).await?;
    let (target, body) = rdp.target_of(&tab_actor).await?;
    let console = target
        .frame
        .and_then(|frame| frame.console_actor)
        .or(target.console_actor)
        .ok_or_else(|| {
            FirefoxError::Failed(format!(
                "No consoleActor returned. Target response: {}",
                truncate(&body.to_string(), TARGET_PREVIEW_CHARS)
            ))
        })?;
    let result = rdp
        .evaluate(&console, &args.expression, EVAL_TIMEOUT)
        .await?;
    println!("{}", serde_json::to_string_pretty(&result.body)?);
    Ok(())
}
