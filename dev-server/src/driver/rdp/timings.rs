//! How long each kind of RDP wait may last.

use std::time::Duration;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(12);
const REPLY_TIMEOUT: Duration = Duration::from_secs(9);
const AWAKE_BACKGROUND_TIMEOUT: Duration = Duration::from_millis(2500);
const WOKEN_BACKGROUND_TIMEOUT: Duration = Duration::from_secs(9);
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// How long each kind of wait may last.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RdpTimings {
    /// TCP connect, and separately the root greeting (`RDP_CONNECT_TIMEOUT_MS`).
    pub connect: Duration,
    /// One request reply (`RDP_REPLY_TIMEOUT_MS`).
    pub reply: Duration,
    /// Probing whether the background page is already awake (`AWAKE_BACKGROUND_WAIT_MS`).
    pub awake_background: Duration,
    /// Waiting for the background page after a wake (`WOKEN_BACKGROUND_WAIT_MS`).
    pub woken_background: Duration,
    /// The liveness connect probe.
    pub probe: Duration,
}

impl RdpTimings {
    /// The limits of the TypeScript client; `const` so [`super::RdpClient::new`] can stay `const`.
    pub(super) const DEFAULT: Self = Self {
        connect: CONNECT_TIMEOUT,
        reply: REPLY_TIMEOUT,
        awake_background: AWAKE_BACKGROUND_TIMEOUT,
        woken_background: WOKEN_BACKGROUND_TIMEOUT,
        probe: PROBE_TIMEOUT,
    };
}

impl Default for RdpTimings {
    fn default() -> Self {
        Self::DEFAULT
    }
}
