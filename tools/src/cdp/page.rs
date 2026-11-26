//! `eval`, `reload` and `bisect`: act on the watch page and the extension.

use std::time::Duration;

use clap::{Args, Subcommand};

use crate::cdp::script;
use crate::cdp::wire::{
    evaluate_on, open_target, print_json, Method, PortArg, ReloadParameters, Result, Session,
    Targets, Wanted, EXTENSION_ID,
};

const BISECT_REPLY_TIMEOUT: Duration = Duration::from_secs(8);

/// Arguments of `eval`.
#[derive(Debug, Args)]
pub(crate) struct EvalArgs {
    /// The target's WebSocket debugger URL
    ws_url: String,
    /// The JavaScript expression (a returned promise is awaited)
    expression: String,
}

/// Steps that isolate which link of the click-to-download chain breaks.
#[derive(Debug, Subcommand)]
pub(crate) enum Bisect {
    /// Prove the watch page answers a trivial evaluation
    Ping(PortArg),
    /// Reload the extension, then every watch page
    Reload(PortArg),
    /// Click the extension's "Download" button on the watch page
    ClickDownload(PortArg),
}

/// Evaluates an expression in the target at the URL and prints the raw result object.
pub(crate) async fn eval(args: EvalArgs) -> Result<()> {
    let mut session = Session::open(&args.ws_url).await?;
    let outcome = session.evaluate_raw(&args.expression).await;
    session.close().await;
    print_json(&outcome?)
}

/// Reloads the first watch page without clearing its cache.
pub(crate) async fn reload(port: PortArg) -> Result<()> {
    let targets = port.targets().await?;
    let Some(watch) = targets.find(Wanted::WatchTab) else {
        println!("no yt");
        return Ok(());
    };
    reload_page(watch).await?;
    println!("reloaded");
    Ok(())
}

async fn reload_page(target: &ytdl_dev_hot::driver::cdp::CdpTarget) -> Result<()> {
    let mut session = open_target(target)
        .await?
        .with_reply_timeout(BISECT_REPLY_TIMEOUT);
    let outcome = session
        .call(Method::PageReload, &ReloadParameters::KEEPING_CACHE)
        .await;
    session.close().await;
    outcome.map(drop)
}

/// Runs one `bisect` command.
pub(crate) async fn run_bisect(command: Bisect) -> Result<()> {
    match command {
        Bisect::Ping(port) => ping(port).await,
        Bisect::Reload(port) => reload_all(&port.targets().await?).await,
        Bisect::ClickDownload(port) => click_download(port).await,
    }
}

async fn ping(port: PortArg) -> Result<()> {
    let targets = port.targets().await?;
    let Some(watch) = targets.find(Wanted::WatchTab) else {
        println!("no YT tab found");
        return Ok(());
    };
    println!(
        "ytTab: {} {}",
        watch.url,
        watch.debugger_url().unwrap_or("")
    );
    let mut session = open_target(watch)
        .await?
        .with_reply_timeout(BISECT_REPLY_TIMEOUT);
    let outcome = session.evaluate_raw(script::PING).await;
    session.close().await;
    println!("ping result:");
    print_json(&outcome?)
}

async fn click_download(port: PortArg) -> Result<()> {
    let targets = port.targets().await?;
    let Some(watch) = targets.find(Wanted::WatchTab) else {
        println!("no YT tab found");
        return Ok(());
    };
    print_json(
        &evaluate_on(watch, script::CLICK_DOWNLOAD)
            .await?
            .into_value()?,
    )
}

async fn reload_all(targets: &Targets) -> Result<()> {
    if let Some(page) = targets.find(Wanted::ExtensionsPage) {
        evaluate_on(page, &script::reload_extension(EXTENSION_ID)).await?;
        println!("extension fully reloaded via developerPrivate");
    } else if let Some(worker) = targets.find(Wanted::AnyExtensionWorker) {
        evaluate_on(worker, script::RUNTIME_RELOAD).await.ok();
        println!("fallback: SW reload signaled (manifest may stay stale)");
    }
    for tab in targets.filter(Wanted::WatchTab) {
        reload_page(tab).await?;
        println!("reloaded {}", tab.url);
    }
    Ok(())
}
