//! Matches responses to requests: hands out ids and parks a oneshot per pending request.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde_json::Value;
use tokio::sync::oneshot;

use crate::bridge::protocol::Response;
use crate::error::{Error, Result};
use crate::types::RequestId;

type Waiter = oneshot::Sender<Result<Value>>;

/// The id source and the waiters of every in-flight request.
#[derive(Debug, Default)]
pub(crate) struct Correlator {
    next: AtomicU64,
    pending: Mutex<Pending>,
}

#[derive(Debug, Default)]
struct Pending {
    waiters: HashMap<RequestId, Waiter>,
    is_closed: bool,
}

fn fail(waiter: Waiter) {
    let _ = waiter.send(Err(Error::BridgeClosed));
}

impl Correlator {
    fn lock(&self) -> MutexGuard<'_, Pending> {
        self.pending.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Registers a new pending request. After [`Correlator::fail_all`] the bridge is closed for
    /// good, and the returned receiver is already failed with [`Error::BridgeClosed`].
    pub(crate) fn register(&self) -> (RequestId, oneshot::Receiver<Result<Value>>) {
        let id = RequestId(self.next.fetch_add(1, Ordering::Relaxed));
        let (sender, receiver) = oneshot::channel();
        let mut pending = self.lock();
        if pending.is_closed {
            fail(sender);
        } else {
            pending.waiters.insert(id, sender);
        }
        drop(pending);
        (id, receiver)
    }

    /// Delivers a response to its waiter; false when nobody waits for that id.
    pub(crate) fn resolve(&self, response: Response) -> bool {
        let waiter = self.lock().waiters.remove(&response.id);
        waiter.is_some_and(|sender| sender.send(response.into_result()).is_ok())
    }

    /// Stops waiting for `id` (its request never left the queue).
    pub(crate) fn forget(&self, id: RequestId) {
        self.lock().waiters.remove(&id);
    }

    /// Fails every pending request with [`Error::BridgeClosed`] and refuses later ones.
    pub(crate) fn fail_all(&self) {
        let drained: Vec<_> = {
            let mut pending = self.lock();
            pending.is_closed = true;
            pending.waiters.drain().map(|(_, waiter)| waiter).collect()
        };
        for waiter in drained {
            fail(waiter);
        }
    }
}
