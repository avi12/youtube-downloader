//! `inspect` and `check`: read-only looks at the extension's state in the browser.

use std::time::Duration;

use clap::Subcommand;
use serde_json::{json, Value};
use ytdl_dev_hot::driver::cdp::CdpTarget;

use super::script;
use super::wire::{evaluate_on, open_target, print_json, Method, PortArg, Result, Targets, Wanted};

const URL_COLUMN_CHARS: usize = 120;
const TYPE_COLUMN_WIDTH: usize = 20;
const DOWNLOADS_RELOAD_SETTLE: Duration = Duration::from_millis(1500);

/// Dumps of what the pages and the service worker currently hold.
#[derive(Debug, Subcommand)]
pub(crate) enum Inspect {
    /// The download-like buttons of the watch page with their ancestor chains
    Buttons(PortArg),
    /// The items of the `chrome://downloads` tab (reloads it first)
    Downloads(PortArg),
    /// The latest downloads as `chrome.downloads` reports them
    DownloadsApi(PortArg),
    /// Every installed extension
    Extensions(PortArg),
    /// All targets, the watch page's buttons and snackbars, and the downloads items
    State(PortArg),
}

/// Pass or fail checks of the extension.
#[derive(Debug, Subcommand)]
pub(crate) enum Check {
    /// The player's playability status and the video element
    Playability(PortArg),
    /// Whether the download button has its click handler
    ClickBound(PortArg),
    /// The watch page's footprint and the service worker's liveness
    ExtHealth(PortArg),
}

/// Evaluates `expression` in the first target of the kind and prints its value; says `missing`
/// when no such target is open.
async fn show(port: PortArg, wanted: Wanted, missing: &str, expression: &str) -> Result<()> {
    let targets = port.targets().await?;
    let Some(target) = targets.find(wanted) else {
        println!("{missing}");
        return Ok(());
    };
    print_json(&evaluate_on(target, expression).await?.into_value()?)
}

/// Runs one `inspect` command.
pub(crate) async fn run_inspect(command: Inspect) -> Result<()> {
    match command {
        Inspect::Buttons(port) => {
            show(port, Wanted::WatchTab, "no yt", script::BUTTON_CHAINS).await
        }
        Inspect::Downloads(port) => downloads(port).await,
        Inspect::DownloadsApi(port) => {
            show(
                port,
                Wanted::ExtensionWorker,
                "no SW",
                script::DOWNLOADS_API,
            )
            .await
        }
        Inspect::Extensions(port) => {
            show(
                port,
                Wanted::ExtensionWorker,
                "no project SW target",
                script::EXTENSIONS,
            )
            .await
        }
        Inspect::State(port) => state(&port.targets().await?).await,
    }
}

/// Runs one `check` command.
pub(crate) async fn run_check(command: Check) -> Result<()> {
    match command {
        Check::Playability(port) => {
            show(port, Wanted::WatchTab, "no yt", script::PLAYABILITY).await
        }
        Check::ClickBound(port) => show(port, Wanted::WatchTab, "no yt", script::CLICK_BOUND).await,
        Check::ExtHealth(port) => ext_health(&port.targets().await?).await,
    }
}

async fn downloads(port: PortArg) -> Result<()> {
    let targets = port.targets().await?;
    let Some(target) = targets.find(Wanted::DownloadsTab) else {
        println!("no downloads tab");
        return Ok(());
    };
    let mut session = open_target(target).await?;
    session.call(Method::PageReload, json!({})).await?;
    tokio::time::sleep(DOWNLOADS_RELOAD_SETTLE).await;
    let outcome = session.evaluate(script::DOWNLOAD_ITEMS_FULL).await;
    session.close().await;
    print_json(&outcome?.into_value()?)
}

/// A value, or `{"ex": message}` when the page threw, so one failure does not stop the report.
async fn lenient(target: &CdpTarget, expression: &str) -> Result<Value> {
    let evaluation = evaluate_on(target, expression).await?;
    Ok(evaluation
        .exception
        .map_or(evaluation.value, |message| json!({ "ex": message })))
}

async fn section(title: &str, target: &CdpTarget, expression: &str) -> Result<()> {
    println!("\n=== {title} ===");
    print_json(&lenient(target, expression).await?)
}

async fn state(targets: &Targets) -> Result<()> {
    println!("=== ALL TARGETS ===");
    for target in targets.all() {
        let kind = format!("{:?}", target.kind);
        let url: String = target.url.chars().take(URL_COLUMN_CHARS).collect();
        println!("{kind:<TYPE_COLUMN_WIDTH$} {url}");
    }
    if let Some(watch) = targets.find(Wanted::WatchTab) {
        section(
            "YT TAB: download button state",
            watch,
            script::BUTTON_LABELS,
        )
        .await?;
        section("YT TAB: watch-snackbar state", watch, script::SNACKBARS).await?;
    }
    let Some(downloads) = targets.find(Wanted::DownloadsTab) else {
        println!("\n=== No chrome://downloads tab open ===");
        return Ok(());
    };
    section(
        "DOWNLOADS TAB: items",
        downloads,
        script::DOWNLOAD_ITEMS_SHORT,
    )
    .await
}

async fn ext_health(targets: &Targets) -> Result<()> {
    if let Some(watch) = targets.find(Wanted::WatchTab) {
        let health = evaluate_on(watch, script::PAGE_HEALTH)
            .await?
            .into_value()?;
        println!("YT eval: {}", serde_json::to_string_pretty(&health)?);
        let errors = evaluate_on(watch, script::PAGE_ERRORS)
            .await?
            .into_value()?;
        println!("YT errors: {}", serde_json::to_string_pretty(&errors)?);
    }
    let Some(worker) = targets.find(Wanted::ExtensionWorker) else {
        println!("SW not found");
        return Ok(());
    };
    let health = evaluate_on(worker, script::WORKER_HEALTH)
        .await?
        .into_value()?;
    println!("SW eval: {}", serde_json::to_string_pretty(&health)?);
    Ok(())
}
