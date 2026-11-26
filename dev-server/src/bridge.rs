//! The stdio JSON-lines RPC client to the TypeScript host.
//!
//! Replaces nothing in TypeScript: it is the new seam. [`Host`] is what the orchestrator calls;
//! [`BridgeClient`] implements it by writing a request line and awaiting the response with the
//! same id. [`connect`] spawns the two pump tasks (stdin lines to responses/notifications, the
//! outbound queue to stdout).
//!
//! [`connect`] details: both queues are bounded; the reader task decodes each line as an
//! [`protocol::InboundMessage`], resolves responses by id and routes `{"notify":"shutdown"}` to
//! the shutdown token (and to the notification queue). Reader and writer share a stop token:
//! whichever ends first stops the other. On EOF, error or shutdown the reader fails every
//! in-flight request with [`crate::Error::BridgeClosed`], and the writer drains what was already
//! queued (final logs) before it ends. stdout is written only by the writer task. A line that does
//! not decode is logged and skipped, so a stray line can never wedge the bridge.

mod client;
pub mod logging;
pub mod protocol;
mod pump;

use std::future::Future;

pub use client::BridgeClient;
pub use pump::{connect, BridgeLink};

use crate::bridge::protocol::{EntrypointLayout, RebuildHmrResult, ReloadExtensionParams};
use crate::error::Result;

/// Capacity of the bridge's outbound and notification queues.
const BRIDGE_CHANNEL_CAPACITY: usize = 64;

/// The operations that stay in TypeScript, as the orchestrator sees them. Each one is a
/// [`protocol::HostRequest`] variant on the wire.
pub trait Host: Send + Sync {
    /// `buildExtension`: the WXT build; reports the entrypoint layout it resolved, when known.
    fn build_extension(&self) -> impl Future<Output = Result<Option<EntrypointLayout>>> + Send;
    /// `rebuildHmr`: the HMR module build; returns the new HMR graph.
    fn rebuild_hmr(&self) -> impl Future<Output = Result<RebuildHmrResult>> + Send;
    /// `reloadExtension`: `runner.reloadAllExtensions()` and browser-specific teardown.
    fn reload_extension(
        &self,
        parameters: ReloadExtensionParams,
    ) -> impl Future<Output = Result<()>> + Send;
    /// `injectHmr`: injects the HMR runtime into open `YouTube` tabs; true when it injected.
    fn inject_hmr(&self) -> impl Future<Output = Result<bool>> + Send;
    /// `refreshEnv`: `reloadDevEnv()`.
    fn refresh_env(&self) -> impl Future<Output = Result<()>> + Send;
}
