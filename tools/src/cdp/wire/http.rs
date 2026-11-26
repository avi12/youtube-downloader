//! The debug port's plain HTTP endpoints, over a bare TCP stream.

use std::net::Ipv4Addr;
use std::time::Duration;

use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

use crate::cdp::wire::error::{CdpError, Result};

const HTTP_TIMEOUT: Duration = Duration::from_secs(5);
const GET_ATTEMPTS: usize = 3;
const HEADER_END: &str = "\r\n\r\n";
const OK_STATUS: &str = " 200 ";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionInfo {
    web_socket_debugger_url: String,
}

/// Splits a raw HTTP response into its status line and body.
fn split_response(raw: &str) -> Option<(&str, &str)> {
    let (head, body) = raw.split_once(HEADER_END)?;
    Some((head.lines().next()?, body))
}

async fn send(port: u16, verb: &str, path: &str) -> Result<String> {
    let request =
        format!("{verb} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    let exchange = async {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await?;
        stream.write_all(request.as_bytes()).await?;
        let mut raw = Vec::new();
        stream.read_to_end(&mut raw).await?;
        Ok::<_, CdpError>(String::from_utf8_lossy(&raw).into_owned())
    };
    let raw = timeout(HTTP_TIMEOUT, exchange)
        .await
        .map_err(|_| CdpError::Timeout("the debug port"))??;
    let (status, body) =
        split_response(&raw).ok_or_else(|| CdpError::Http("no header end".into()))?;
    if !status.contains(OK_STATUS) {
        return Err(CdpError::Http(status.to_owned()));
    }
    Ok(body.to_owned())
}

/// A reload or a waking service worker can leave the debug port unanswered for a few seconds; a
/// `GET` changes nothing, so it is safe to ask again.
async fn get(port: u16, path: &str) -> Result<String> {
    let mut outcome = send(port, "GET", path).await;
    for _ in 1..GET_ATTEMPTS {
        if !matches!(outcome, Err(CdpError::Timeout(_))) {
            break;
        }
        outcome = send(port, "GET", path).await;
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
        &send(port, "PUT", &format!("/json/new?{url}")).await?,
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

#[cfg(test)]
mod tests {
    use crate::cdp::wire::http::*;

    #[test]
    fn splits_status_and_body() {
        let raw = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
        assert_eq!(split_response(raw), Some(("HTTP/1.1 200 OK", "{}")));
    }

    #[test]
    fn rejects_a_response_without_headers_end() {
        assert_eq!(split_response("HTTP/1.1 200 OK"), None);
    }
}
