//! [`HmrHandle`]: the server's shared state and its broadcast side.

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use tokio::sync::broadcast;
use tokio::time::Instant;

use crate::hmr_server::push::PushKind;

/// How many unsent messages a client may lag behind before it is closed.
const CLIENT_LAG_CAPACITY: usize = 32;

/// The server's shared state and the way to publish to every connected runtime. Cheap to clone.
#[derive(Debug, Clone)]
pub struct HmrHandle {
    sender: broadcast::Sender<Arc<str>>,
    last_import_push: Arc<Mutex<Option<Instant>>>,
}

impl Default for HmrHandle {
    fn default() -> Self {
        Self::new()
    }
}

impl HmrHandle {
    /// A handle with no clients.
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CLIENT_LAG_CAPACITY);
        Self {
            sender,
            last_import_push: Arc::default(),
        }
    }

    /// A receiver for the server's per-client tasks.
    pub fn subscribe(&self) -> broadcast::Receiver<Arc<str>> {
        self.sender.subscribe()
    }

    /// Sends a manifest payload to every runtime and records the import push.
    pub fn broadcast_manifest(&self, payload: &Arc<str>) {
        let _ = self.sender.send(Arc::clone(payload));
        self.stamp_import_push();
    }

    fn last_import_push(&self) -> MutexGuard<'_, Option<Instant>> {
        self.last_import_push
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Records an import-triggering push (a broadcast or a client's initial sync).
    pub(super) fn stamp_import_push(&self) {
        *self.last_import_push() = Some(Instant::now());
    }

    /// Tells every runtime a reload is about to tear its world down.
    pub fn broadcast_reload_imminent(&self) {
        let _ = self
            .sender
            .send(Arc::from(PushKind::ReloadImminent.bare_payload()));
    }

    /// Connected runtimes.
    pub fn client_count(&self) -> usize {
        self.sender.receiver_count()
    }

    /// Time since the last import-triggering push, `None` before the first; reloads wait out
    /// `PUSH_SETTLE_MS` of it.
    pub fn since_last_import_push(&self) -> Option<Duration> {
        self.last_import_push().map(|pushed| pushed.elapsed())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn a_broadcast_reaches_subscribers_and_stamps_the_push() {
        let handle = HmrHandle::new();
        let mut receiver = handle.subscribe();
        assert_eq!(handle.since_last_import_push(), None);
        handle.broadcast_manifest(&Arc::from(r#"{"type":"manifest"}"#));
        tokio::time::advance(Duration::from_secs(3)).await;
        assert_eq!(
            receiver.recv().await.ok().as_deref(),
            Some(r#"{"type":"manifest"}"#)
        );
        assert_eq!(
            handle.since_last_import_push(),
            Some(Duration::from_secs(3))
        );
        assert_eq!(handle.client_count(), 1);
    }
}
