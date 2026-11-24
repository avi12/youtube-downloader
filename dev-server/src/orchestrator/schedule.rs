//! The loop's timers as plain state: when the HMR runtime is injected next and when the static
//! bundle is caught up, so the `select!` arms only read a deadline.

use std::time::Duration;

use tokio::time::Instant;

use super::{HMR_INJECT_MAX_ATTEMPTS, HMR_INJECT_RETRY_DELAY, STATIC_CATCH_UP_IDLE};

/// When the next HMR injection attempt is due: fast retries until the first one lands, then the
/// steady re-injection cadence when the launcher asked for one. Port of `keepHmrInjected`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InjectSchedule {
    next: Option<Instant>,
    attempts: u32,
    is_landed: bool,
    steady: Option<Duration>,
}

impl InjectSchedule {
    /// A schedule whose first attempt is due `now`.
    pub const fn new(now: Instant, steady: Option<Duration>) -> Self {
        Self {
            next: Some(now),
            attempts: 0,
            is_landed: false,
            steady,
        }
    }

    /// When the next attempt is due, `None` once the schedule is finished.
    pub const fn next(&self) -> Option<Instant> {
        self.next
    }

    /// Records the outcome of an attempt made at `now` and schedules the following one.
    pub fn record(&mut self, is_injected: bool, now: Instant) {
        if !self.is_landed {
            self.attempts += 1;
            self.is_landed = is_injected;
        }
        let is_retrying = !self.is_landed && self.attempts < HMR_INJECT_MAX_ATTEMPTS;
        self.next = if is_retrying {
            Some(now + HMR_INJECT_RETRY_DELAY)
        } else {
            self.steady.map(|every| now + every)
        };
    }
}

/// Whether the static bundle lags the hot-swapped page, and when it is caught up. A catch-up is
/// only ever due while the bundle is stale. Port of `scheduleStaticBundleCatchUp`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum StaticBundle {
    /// The last build wrote the bundle; nothing to catch up.
    Current,
    /// A hot-swap left the bundle behind and edits are still coming in.
    Stale,
    /// The bundle is stale and the edits went quiet: catch it up at this instant.
    CatchUpDue(Instant),
}

impl StaticBundle {
    /// When the catch-up is due, if one is.
    pub(super) const fn deadline(self) -> Option<Instant> {
        match self {
            Self::CatchUpDue(deadline) => Some(deadline),
            Self::Current | Self::Stale => None,
        }
    }

    pub(super) const fn is_stale(self) -> bool {
        !matches!(self, Self::Current)
    }

    /// Drops a due catch-up and keeps the bundle stale: an edit came in, or the catch-up is running.
    pub(super) const fn without_deadline(self) -> Self {
        match self {
            Self::CatchUpDue(_) => Self::Stale,
            other => other,
        }
    }

    /// A window was drained: a stale bundle is caught up once [`STATIC_CATCH_UP_IDLE`] passes
    /// without edits.
    pub(super) fn schedule_after_drain(self, now: Instant) -> Self {
        if self.is_stale() {
            Self::CatchUpDue(now + STATIC_CATCH_UP_IDLE)
        } else {
            self
        }
    }
}
