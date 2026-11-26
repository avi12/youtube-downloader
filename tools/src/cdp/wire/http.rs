//! The debug port's plain HTTP endpoints, over a bare TCP stream.

use std::time::Duration;

use serde::Deserialize;
use ytdl_dev_hot::driver::cdp::{debug_port_request, Verb};
use ytdl_dev_hot::types::Port;
use ytdl_dev_hot::Error;

use crate::cdp::wire::error::{CdpError, Result};

const HTTP_TIMEOUT: Duration = Duration::from_secs(5);
const GET_ATTEMPTS: usize = 3;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionInfo {
    web_socket_debugger_url: String,
}

async fn send(port: u16, verb: Verb, path: &str) -> Result<String> {
    let port = Port::new(port).map_err(|error| CdpError::Http(error.to_string()))?;
    debug_port_request(port, verb, path, HTTP_TIMEOUT)
        .await
        .map_err(|error| match error {
            Error::Timeout(_) => CdpError::Timeout("the debug port"),
            other => CdpError::Http(other.to_string()),
        })
}

/// A reload or a waking service worker can leave the debug port unanswered for a few seconds; a
/// `GET` changes nothing, so it is safe to ask again.
async fn get(port: u16, path: &str) -> Result<String> {
    let mut outcome = send(port, Verb::Get, path).await;
    for _ in 1..GET_ATTEMPTS {
        if !matches!(outcome, Err(CdpError::Timeout(_))) {
            break;
        }
        outcome = send(port, Verb::Get, path).await;
    }
    outcome
}

/// A tab opened through `/json/new`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NewTab {
    /// The id to close it with.
    pub(crate) id: String,
    /// Where to open a session on it.
    pub(crate) web_socket_debugger_url: String,
}

/// Opens a tab on `url` (`PUT /json/new?<url>`).
pub(crate) async fn open_tab(port: u16, url: &str) -> Result<NewTab> {
    Ok(serde_json::from_str(
        &send(port, Verb::Put, &format!("/json/new?{url}")).await?,
    )?)
}

/// The browser-level WebSocket URL (`/json/version`).
pub(crate) async fn browser_websocket_url(port: u16) -> Result<String> {
    let info: VersionInfo = serde_json::from_str(&get(port, "/json/version").await?)?;
    Ok(info.web_socket_debugger_url)
}

/// Closes one target (`/json/close/<id>`).
pub(crate) async fn close_target(port: u16, target_id: &str) -> Result<()> {
    get(port, &format!("/json/close/{target_id}")).await?;
    Ok(())
}
