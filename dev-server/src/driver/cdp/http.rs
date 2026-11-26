//! The plain HTTP/1.1 requests the debug port's `/json` endpoints answer, over a bare `TcpStream`
//! (no HTTP client crate).

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::driver::net::{is_response_complete, loopback, within, LOOPBACK};
use crate::error::{Error, Result};
use crate::types::Port;

const HTTP_TIMEOUT: Duration = Duration::from_secs(3);
const HEADER_END: &str = "\r\n\r\n";
/// Header lines as they read once the head is lowercased.
const CHUNKED_TRANSFER_HEADER: &str = "transfer-encoding: chunked";

/// The debug port's `/json` endpoints this client reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Endpoint {
    /// Every target of the browser.
    List,
    /// The browser version, answered by any live browser.
    Version,
}

impl Endpoint {
    const fn path(self) -> &'static str {
        match self {
            Self::List => "/json/list",
            Self::Version => "/json/version",
        }
    }
}

/// The request methods the debug port takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verb {
    /// Reads, and closes targets.
    Get,
    /// Opens a target.
    Put,
}

impl Verb {
    const fn text(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Put => "PUT",
        }
    }
}

/// The HTTP statuses this client tells apart; any other one is a failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Status {
    Success,
}

impl Status {
    const fn code(self) -> &'static str {
        match self {
            Self::Success => "200",
        }
    }
}

/// The request line and headers. The `Host` must carry the port: Chrome builds the
/// `webSocketDebuggerUrl` of every target from it, and a bare host yields a URL on port 80.
fn head_of(verb: Verb, path: &str, port: Port) -> String {
    format!(
        "{} {path} HTTP/1.1\r\nHost: {LOOPBACK}:{}\r\nConnection: close\r\n\r\n",
        verb.text(),
        port.get()
    )
}

/// The body of `GET endpoint` on the debug port.
pub(super) async fn get(port: Port, endpoint: Endpoint) -> Result<String> {
    request(port, Verb::Get, endpoint.path(), HTTP_TIMEOUT).await
}

/// The body of a `200` answer from the debug port, bounded by one timeout for the whole exchange.
pub async fn request(port: Port, verb: Verb, path: &str, limit: Duration) -> Result<String> {
    let head = head_of(verb, path, port);
    let exchange = async {
        let mut stream = TcpStream::connect(loopback(port)).await?;
        stream.write_all(head.as_bytes()).await?;
        let mut raw = Vec::new();
        while !is_response_complete(&raw) {
            let is_closed = stream.read_buf(&mut raw).await? == 0;
            if is_closed {
                break;
            }
        }
        Ok::<_, Error>(raw)
    };
    let raw = within(limit, "the CDP HTTP endpoint", exchange).await?;
    body(&raw)
}

/// The body of a `200` HTTP response, or a protocol error.
fn body(raw: &[u8]) -> Result<String> {
    let text = String::from_utf8_lossy(raw);
    let (head, body) = text
        .split_once(HEADER_END)
        .ok_or_else(|| Error::Protocol("incomplete HTTP response".into()))?;
    let status = head
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1));
    let is_unsuccessful = status != Some(Status::Success.code());
    if is_unsuccessful {
        return Err(Error::Protocol(format!(
            "unexpected HTTP status {status:?}"
        )));
    }
    if head.to_ascii_lowercase().contains(CHUNKED_TRANSFER_HEADER) {
        return Err(Error::Protocol(
            "chunked HTTP responses are not supported".into(),
        ));
    }
    Ok(body.to_owned())
}

#[cfg(test)]
mod tests {
    use crate::driver::cdp::http::*;

    const CDP_PORT: u16 = 9229;

    #[test]
    fn the_host_header_carries_the_port() {
        let port = Port::new(CDP_PORT).ok();
        let request = port.map(|port| head_of(Verb::Get, "/json/list", port));
        assert!(request.is_some_and(|text| text.contains("Host: 127.0.0.1:9229\r\n")));
    }

    #[test]
    fn http_bodies_need_a_200() {
        assert_eq!(
            body(b"HTTP/1.1 200 OK\r\nA: b\r\n\r\n[]").ok().as_deref(),
            Some("[]")
        );
        assert!(body(b"HTTP/1.1 404 Not Found\r\n\r\n").is_err());
        assert!(body(b"HTTP/1.1 200 OK").is_err());
    }
}
