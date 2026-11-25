//! The pure debounce and the async loop that drives it.

use std::time::Duration;

use tokio::sync::mpsc;
use tokio::time::{interval, sleep_until, Instant, MissedTickBehavior};
use tokio_util::sync::CancellationToken;

use super::{ChangeBatch, ChangeEvent};

/// A batch waits at most this many windows, however steadily events keep arriving.
const MAX_WAIT_WINDOWS: u32 = 10;

/// Collects events and releases them once the paths have been quiet for the debounce window:
/// every event restarts the window, up to a maximum wait counted from the batch's first event, and a
/// path seen twice keeps its first position and its last kind.
///
/// ```
/// use std::time::Duration;
/// use tokio::time::Instant;
/// use ytdl_dev_hot::types::RelPath;
/// use ytdl_dev_hot::changes::watcher::{ChangeEvent, ChangeKind, Debouncer};
///
/// let mut debouncer = Debouncer::new(Duration::from_millis(800));
/// let start = Instant::now();
/// let event = ChangeEvent { path: RelPath::new("src/a.ts"), kind: ChangeKind::Modified };
/// debouncer.push(event.clone(), start);
/// debouncer.push(event, start + Duration::from_millis(500));
/// assert_eq!(debouncer.deadline(), Some(start + Duration::from_millis(1300)));
/// assert_eq!(debouncer.flush().map(|batch| batch.events.len()), Some(1));
/// assert_eq!(debouncer.deadline(), None);
/// ```
#[derive(Debug, Clone)]
pub struct Debouncer {
    debounce: Duration,
    events: Vec<ChangeEvent>,
    deadline: Option<Instant>,
    latest_deadline: Option<Instant>,
}

impl Debouncer {
    /// An empty debouncer with a quiet window of `debounce`.
    pub const fn new(debounce: Duration) -> Self {
        Self {
            debounce,
            events: Vec::new(),
            deadline: None,
            latest_deadline: None,
        }
    }

    /// Adds an event seen at `now` and restarts the quiet window.
    pub fn push(&mut self, event: ChangeEvent, now: Instant) {
        let latest = *self
            .latest_deadline
            .get_or_insert_with(|| now + self.debounce * MAX_WAIT_WINDOWS);
        self.deadline = Some(latest.min(now + self.debounce));
        let known = self
            .events
            .iter_mut()
            .find(|existing| existing.path == event.path);
        match known {
            Some(existing) => existing.kind = event.kind,
            None => self.events.push(event),
        }
    }

    /// When the pending batch is due, `None` with nothing pending.
    pub const fn deadline(&self) -> Option<Instant> {
        self.deadline
    }

    /// Takes the pending batch, `None` with nothing pending.
    pub fn flush(&mut self) -> Option<ChangeBatch> {
        self.deadline = None;
        self.latest_deadline = None;
        if self.events.is_empty() {
            return None;
        }
        Some(ChangeBatch {
            events: std::mem::take(&mut self.events),
        })
    }
}

/// Quiet window and tick period of [`run_loop`].
#[derive(Debug, Clone, Copy)]
pub(super) struct LoopTiming {
    pub(super) debounce: Duration,
    pub(super) tick: Duration,
}

/// The debounce loop: raw events in, one batch per quiet period out. `on_tick` runs every `tick`
/// and may return events it discovered itself (paths that appeared since startup).
pub(super) async fn run_loop(
    mut raw: mpsc::Receiver<ChangeEvent>,
    batches: mpsc::Sender<ChangeBatch>,
    timing: LoopTiming,
    mut on_tick: impl FnMut() -> Vec<ChangeEvent>,
    shutdown: CancellationToken,
) {
    let mut debouncer = Debouncer::new(timing.debounce);
    let mut ticker = interval(timing.tick);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        let deadline = debouncer.deadline();
        tokio::select! {
            () = shutdown.cancelled() => break,
            received = raw.recv() => {
                let Some(event) = received else { break };
                debouncer.push(event, Instant::now());
            }
            () = sleep_until(deadline.unwrap_or_else(Instant::now)), if deadline.is_some() => {
                let Some(batch) = debouncer.flush() else { continue };
                if batches.send(batch).await.is_err() {
                    break;
                }
            }
            _ = ticker.tick() => {
                for event in on_tick() {
                    debouncer.push(event, Instant::now());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::changes::watcher::ChangeKind;
    use crate::types::RelPath;

    const WINDOW: Duration = Duration::from_millis(800);

    fn event(path: &str, kind: ChangeKind) -> ChangeEvent {
        ChangeEvent {
            path: RelPath::new(path),
            kind,
        }
    }

    #[test]
    fn a_steady_stream_of_events_cannot_hold_a_batch_forever() {
        let mut debouncer = Debouncer::new(WINDOW);
        let start = Instant::now();
        for i in 0..=MAX_WAIT_WINDOWS * 2 {
            debouncer.push(event("a", ChangeKind::Modified), start + WINDOW / 2 * i);
        }
        assert_eq!(
            debouncer.deadline(),
            Some(start + WINDOW * MAX_WAIT_WINDOWS)
        );
    }

    #[test]
    fn a_repeated_path_keeps_its_slot_and_takes_the_last_kind() {
        let mut debouncer = Debouncer::new(WINDOW);
        let now = Instant::now();
        debouncer.push(event("a", ChangeKind::Modified), now);
        debouncer.push(event("b", ChangeKind::Modified), now);
        debouncer.push(event("a", ChangeKind::Removed), now);
        let batch = debouncer.flush();
        assert_eq!(
            batch.map(|found| found.events),
            Some(vec![
                event("a", ChangeKind::Removed),
                event("b", ChangeKind::Modified)
            ])
        );
        assert_eq!(debouncer.flush(), None);
    }

    fn harness(
        on_tick: impl FnMut() -> Vec<ChangeEvent> + Send + 'static,
    ) -> (
        mpsc::Sender<ChangeEvent>,
        mpsc::Receiver<ChangeBatch>,
        CancellationToken,
    ) {
        let (raw_sender, raw_receiver) = mpsc::channel(8);
        let (batch_sender, batch_receiver) = mpsc::channel(8);
        let shutdown = CancellationToken::new();
        tokio::spawn(run_loop(
            raw_receiver,
            batch_sender,
            LoopTiming {
                debounce: WINDOW,
                tick: Duration::from_millis(500),
            },
            on_tick,
            shutdown.clone(),
        ));
        (raw_sender, batch_receiver, shutdown)
    }

    #[tokio::test(start_paused = true)]
    async fn each_event_restarts_the_quiet_window() {
        let (raw, mut batches, _shutdown) = harness(Vec::new);
        assert!(raw.send(event("a", ChangeKind::Modified)).await.is_ok());
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert!(raw.send(event("b", ChangeKind::Modified)).await.is_ok());
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert!(batches.try_recv().is_err());
        let batch = batches.recv().await;
        assert_eq!(batch.map(|found| found.events.len()), Some(2));
    }

    #[tokio::test(start_paused = true)]
    async fn the_tick_can_report_late_appearing_paths() {
        let mut pending = vec![event("src/.env", ChangeKind::Modified)];
        let (_raw, mut batches, _shutdown) = harness(move || std::mem::take(&mut pending));
        let batch = batches.recv().await;
        assert_eq!(
            batch.map(|found| found.events),
            Some(vec![event("src/.env", ChangeKind::Modified)])
        );
    }

    #[tokio::test(start_paused = true)]
    async fn shutdown_closes_the_channel() {
        let (_raw, mut batches, shutdown) = harness(Vec::new);
        shutdown.cancel();
        assert!(batches.recv().await.is_none());
    }
}
