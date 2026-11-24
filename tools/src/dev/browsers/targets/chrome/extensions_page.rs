//! Runs script on a temporary `chrome://extensions` tab. Its `developerPrivate` API reloads any
//! extension and needs no live service worker, which Chrome stops after about 30 s of idling.

use std::time::Duration;

use serde_json::Value;
use ytdl_dev_hot::types::Port;

use crate::cdp::wire::{close_target, open_tab, Session};
use crate::dev::browsers::error::{BrowserError, Result};

const EXTENSIONS_PAGE_URL: &str = "chrome://extensions";
const READY_ATTEMPTS: usize = 25;
const READY_POLL: Duration = Duration::from_millis(200);

async fn evaluate_in_session(url: &str, expression: &str) -> Result<Value> {
    let mut session = Session::open(url).await?;
    let outcome = session.evaluate(expression).await;
    session.close().await;
    Ok(outcome?.into_value()?)
}

/// The page injects its API a moment after the tab opens, so the evaluation is retried until it holds.
async fn evaluate_when_ready(url: &str, expression: &str) -> Result<Value> {
    let mut last = BrowserError::Timeout("the extensions page");
    for _ in 0..READY_ATTEMPTS {
        match evaluate_in_session(url, expression).await {
            Ok(value) => return Ok(value),
            Err(error) => last = error,
        }
        tokio::time::sleep(READY_POLL).await;
    }
    Err(last)
}

/// Evaluates an expression (awaiting a returned promise) on a fresh `chrome://extensions` tab and
/// closes the tab again, whatever the outcome.
pub(super) async fn evaluate_on_extensions_page(port: Port, expression: &str) -> Result<Value> {
    let tab = open_tab(port.get(), EXTENSIONS_PAGE_URL).await?;
    let outcome = evaluate_when_ready(&tab.web_socket_debugger_url, expression).await;
    close_target(port.get(), &tab.id).await.ok();
    outcome
}
