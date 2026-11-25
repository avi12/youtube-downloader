//! The two network primitives both protocols share: the loopback address of a debug port, and a
//! bounded wait that turns an elapsed deadline into [`Error::Timeout`].

use std::future::Future;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use tokio::time::{timeout_at, Instant};

use crate::error::{Error, Result};
use crate::types::Port;

/// Separates the head of an HTTP response from its body.
const HEADER_END: &str = "\r\n\r\n";
const CONTENT_LENGTH_HEADER: &str = "content-length:";

/// The host every debug port listens on.
pub(super) const LOOPBACK: Ipv4Addr = Ipv4Addr::LOCALHOST;

/// The loopback socket address of `port`.
pub(super) fn loopback(port: Port) -> SocketAddr {
    SocketAddr::from((LOOPBACK, port.get()))
}

/// Runs `operation` for at most `limit`; an elapsed limit is [`Error::Timeout`] naming `what`.
pub(super) async fn within<T, E>(
    limit: Duration,
    what: &'static str,
    operation: impl Future<Output = std::result::Result<T, E>>,
) -> Result<T>
where
    Error: From<E>,
{
    until(Instant::now() + limit, what, operation).await
}

/// Runs `operation` until `deadline`; a passed deadline is [`Error::Timeout`] naming `what`.
pub(super) async fn until<T, E>(
    deadline: Instant,
    what: &'static str,
    operation: impl Future<Output = std::result::Result<T, E>>,
) -> Result<T>
where
    Error: From<E>,
{
    let outcome = timeout_at(deadline, operation)
        .await
        .map_err(|_elapsed| Error::Timeout(what))?;
    outcome.map_err(Error::from)
}

/// Whether `raw` holds the whole response: the headers and `Content-Length` bytes of body. Chrome's
/// `DevTools` HTTP server ignores `Connection: close` and keeps the socket open, so the response has
/// to be framed by its length rather than read to the end.
pub(super) fn is_response_complete(raw: &[u8]) -> bool {
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

#[cfg(test)]
mod tests {
    use super::*;

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
