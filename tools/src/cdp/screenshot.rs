//! `screenshot`: PNG captures of the extension popup or of any page.

use std::path::PathBuf;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use clap::Subcommand;
use serde::Deserialize;
use serde_json::json;
use tokio::fs;
use ytdl_dev_hot::driver::cdp::{CdpTarget, TargetKind};

use crate::cdp::wire::EXTENSION_ID;
use crate::cdp::wire::{
    browser_websocket_url, close_target, open_target, print_json, CdpError, Method, PortArg,
    Result, Session, Targets, Wanted,
};
use crate::port::parse_port_number;

const POPUP_WIDTH: u32 = 400;
const POPUP_HEIGHT: u32 = 620;
const POPUP_SCALE: u32 = 2;
const DEFAULT_POPUP_OUTPUT: &str = "scripts/popup-current.png";
const POPUP_PAGE_LOAD_SETTLE: Duration = Duration::from_millis(1500);
const POPUP_EMULATION_SETTLE: Duration = Duration::from_millis(600);

/// Screenshots.
#[derive(Debug, Subcommand)]
pub(crate) enum Screenshot {
    /// Open the popup in its own window, capture it and close it
    Popup {
        #[command(flatten)]
        port: PortArg,
        /// Where to write the PNG
        #[arg(default_value = DEFAULT_POPUP_OUTPUT)]
        output: PathBuf,
    },
    /// Capture the first page whose URL contains the text, after an optional evaluation
    Page {
        /// The browser's remote debugging port
        #[arg(value_parser = parse_port_number)]
        port: u16,
        /// Text the page URL contains
        url_match: String,
        /// Where to write the PNG
        output: PathBuf,
        /// An expression to evaluate and print first
        expression: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
struct Capture {
    data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Created {
    target_id: String,
}

/// Runs one `screenshot` command.
pub(crate) async fn run(command: Screenshot) -> Result<()> {
    match command {
        Screenshot::Popup { port, output } => popup(port, &output).await,
        Screenshot::Page {
            port,
            url_match,
            output,
            expression,
        } => page(PortArg { port }, &url_match, &output, expression.as_deref()).await,
    }
}

async fn write_capture(
    session: &mut Session,
    output: &PathBuf,
    params: serde_json::Value,
) -> Result<()> {
    let capture: Capture =
        serde_json::from_value(session.call(Method::PageCaptureScreenshot, params).await?)?;
    fs::write(output, STANDARD.decode(capture.data)?).await?;
    println!("Saved {}", output.display());
    Ok(())
}

async fn page(
    port: PortArg,
    url_match: &str,
    output: &PathBuf,
    expression: Option<&str>,
) -> Result<()> {
    let targets = port.targets().await?;
    let target =
        find_page(&targets, url_match).ok_or_else(|| CdpError::Protocol("no target".to_owned()))?;
    let mut session = open_target(target).await?;
    if let Some(expression) = expression {
        print_json(&session.evaluate_raw(expression).await?)?;
    }
    let outcome = write_capture(&mut session, output, json!({ "format": "png" })).await;
    session.close().await;
    outcome
}

fn find_page<'targets>(targets: &'targets Targets, url_match: &str) -> Option<&'targets CdpTarget> {
    targets
        .all()
        .iter()
        .find(|target| target.kind == TargetKind::Page && target.url.contains(url_match))
}

async fn popup(port: PortArg, output: &PathBuf) -> Result<()> {
    let stale = port.targets().await?;
    let mut closed = 0_usize;
    for target in stale.filter(Wanted::Popup) {
        close_target(port.port, &target.id.to_string()).await.ok();
        closed += 1;
    }
    println!("Closed {closed} stale popup target(s)");
    let browser_url = browser_websocket_url(port.port).await?;
    println!("Browser WS: {browser_url}");
    let target_id = create_popup(&browser_url).await?;
    println!("Opened popup target: {target_id}");
    tokio::time::sleep(POPUP_PAGE_LOAD_SETTLE).await;
    let outcome = capture_popup(port, &target_id, output).await;
    close_target(port.port, &target_id).await.ok();
    outcome?;
    println!("Closed popup target");
    Ok(())
}

async fn create_popup(browser_url: &str) -> Result<String> {
    let mut session = Session::open(browser_url).await?;
    let params = json!({
        "url": format!("chrome-extension://{EXTENSION_ID}/popup.html"),
        "width": POPUP_WIDTH,
        "height": POPUP_HEIGHT,
        "newWindow": true,
    });
    let outcome = session.call(Method::TargetCreateTarget, params).await;
    session.close().await;
    let created: Created = serde_json::from_value(outcome?)?;
    Ok(created.target_id)
}

async fn capture_popup(port: PortArg, target_id: &str, output: &PathBuf) -> Result<()> {
    let targets = port.targets().await?;
    let target = targets
        .all()
        .iter()
        .find(|candidate| candidate.id.to_string() == target_id)
        .ok_or_else(|| CdpError::Protocol(format!("Target {target_id} not found post-create")))?;
    let mut session = open_target(target).await?;
    let outcome = emulate_and_capture(&mut session, output).await;
    session.close().await;
    outcome
}

async fn emulate_and_capture(session: &mut Session, output: &PathBuf) -> Result<()> {
    session.call(Method::PageEnable, json!({})).await?;
    let metrics = json!({
        "width": POPUP_WIDTH,
        "height": POPUP_HEIGHT,
        "deviceScaleFactor": POPUP_SCALE,
        "mobile": false,
    });
    session
        .call(Method::EmulationSetDeviceMetricsOverride, metrics)
        .await?;
    tokio::time::sleep(POPUP_EMULATION_SETTLE).await;
    write_capture(
        session,
        output,
        json!({ "format": "png", "captureBeyondViewport": true }),
    )
    .await
}
