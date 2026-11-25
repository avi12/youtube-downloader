//! The debug port's plain HTTP endpoints, over a bare TCP stream.

use std::net::Ipv4Addr;
use std::time::Duration;

use serde::Deserialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;

use super::error::{CdpError, Result};

const HTTP_TIMEOUT: Duration = Duration::from_secs(5);
const GET_ATTEMPTS: usize = 3;
const HEADER_END: &str = "\r\n\r\n";
const OK_STATUS: &str = " 200 ";
const CONTENT_LENGTH_HEADER: &str = "content-length:";

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

/// Whether `raw` holds the headers and `Content-Length` bytes of body. Chrome keeps the socket open
/// despite `Connection: close`, so a response is framed by its length, not by the end of the stream.
fn is_response_complete(raw: &[u8]) -> bool {
    let Some(header_end) = raw
        .windows(HEADER_END.len())
        .position(|window| window == HEADER_END.as_bytes())
    else {
        return false;
    };
    let head =
        String::from_utf8_lossy(raw.get(..header_end).unwrap_or_default()).to_ascii_lowercase();
    let content_length = head.lines().find_map(|line| {
        line.strip_prefix(CONTENT_LENGTH_HEADER)
            .and_then(|value| value.trim().parse::<usize>().ok())
    });
    content_length.is_some_and(|length| raw.len() >= header_end + HEADER_END.len() + length)
}

async fn send(port: u16, verb: &str, path: &str) -> Result<String> {
    let request =
        format!("{verb} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    let exchange = async {
        let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).await?;
        stream.write_all(request.as_bytes()).await?;
        let mut raw = Vec::new();
        while !is_response_complete(&raw) {
            if stream.read_buf(&mut raw).await? == 0 {
                break;
            }
        }
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
    use super::*;

    #[test]
    fn a_response_ends_at_its_content_length() {
        let whole = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
        let (cut_short, _) = whole.split_at(whole.len() - 1);
        assert!(!is_response_complete(cut_short));
        assert!(is_response_complete(whole));
    }

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
