//! The two network primitives both protocols share: the loopback address of a debug port, and a
//! bounded wait that turns an elapsed deadline into [`Error::Timeout`].

use std::future::Future;
use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use tokio::time::{timeout_at, Instant};

use crate::error::{Error, Result};
use crate::types::Port;

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
