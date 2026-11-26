//! The plain HTTP/1.1 GET the debug port's `/json` endpoints answer, over a bare `TcpStream` (no
//! HTTP client crate).

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::driver::net::{loopback, within, LOOPBACK};
use crate::error::{Error, Result};
use crate::types::Port;

const HTTP_TIMEOUT: Duration = Duration::from_secs(3);
const HEADER_END: &str = "\r\n\r\n";
/// Header lines as they read once the head is lowercased.
const CONTENT_LENGTH_HEADER: &str = "content-length:";
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

/// The request line and headers of a `GET`. The `Host` must carry the port: Chrome builds the
/// `webSocketDebuggerUrl` of every target from it, and a bare host yields a URL on port 80.
fn request_for(path: &str, port: Port) -> String {
    format!(
        "GET {path} HTTP/1.1\r\nHost: {LOOPBACK}:{}\r\nConnection: close\r\n\r\n",
        port.get()
    )
}

/// The body of `GET endpoint` on the debug port, bounded by one timeout for the whole exchange.
pub(super) async fn get(port: Port, endpoint: Endpoint) -> Result<String> {
    let path = endpoint.path();
    let request = request_for(path, port);
    let exchange = async {
        let mut stream = TcpStream::connect(loopback(port)).await?;
        stream.write_all(request.as_bytes()).await?;
        let mut raw = Vec::new();
        while !is_response_complete(&raw) {
            let is_closed = stream.read_buf(&mut raw).await? == 0;
            if is_closed {
                break;
            }
        }
        Ok::<_, Error>(raw)
    };
    let raw = within(HTTP_TIMEOUT, "the CDP HTTP endpoint", exchange).await?;
    body(&raw)
}

/// Whether `raw` holds the whole response: the headers and `Content-Length` bytes of body. Chrome's
/// `DevTools` HTTP server ignores `Connection: close` and keeps the socket open, so the response has
/// to be framed by its length rather than read to the end.
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
        let request = port.map(|port| request_for("/json/list", port));
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

    #[test]
    fn a_response_is_complete_once_its_content_length_arrived() {
        assert!(!is_response_complete(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2"
        ));
        assert!(!is_response_complete(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n["
        ));
        assert!(is_response_complete(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n[]"
        ));
        assert!(!is_response_complete(b"HTTP/1.1 200 OK\r\n\r\n[]"));
    }
}
