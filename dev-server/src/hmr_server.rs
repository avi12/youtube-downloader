//! The HMR push channel: a WebSocket server the injected page runtime (`scripts/dev/hmr/runtime/runtime.ts`, which
//! stays JavaScript) connects to, plus the manifest payload it receives.
//!
//! Replaces, in the TypeScript dev server it replaced: `startHmrPushServer` (accept loop, per-client
//! ping timer and pong tracking, initial manifest sync on connect), `hmrManifestPayload`,
//! `broadcastToHmrClients`, `broadcastHmrManifest`, `broadcastHmrReloadImminent`,
//! `writeHmrManifestExtras`, and the `lastImportPushAt` bookkeeping behind `PUSH_SETTLE_MS`.
//! (`findFreeTcpPort` stays in TypeScript: the launcher passes a free [`crate::types::Port`].)
//!
//! Behavior:
//! - Listen on `127.0.0.1:<hmr_port>` only.
//! - Per client: every ping interval (ten seconds) send `{"type":"ping"}`; if the previous ping
//!   was not answered with `{"type":"pong"}`, close the socket (a dead world can leave TCP open).
//!   Ignore non-JSON and unknown messages. Drop the client on close or error.
//! - On connect, send the current manifest payload if the manifest file exists, and record an
//!   import push.
//! - A broadcast is a `tokio::sync::broadcast` of `Arc<str>` (one allocation shared by all
//!   clients); a lagging client is closed, not waited for.
//! - Payload shapes (the runtime parses these): `{"type":"manifest","manifest":<raw file text>}`,
//!   `{"type":"reload-imminent"}`, `{"type":"ping"}`.
//! - [`write_manifest_extras`] rewrites `hmr/manifest.json` adding `overlay` and
//!   `resourceVersions`; blocking, run it under `spawn_blocking`.

mod connection;
mod handle;
mod manifest;
mod push;

use std::net::Ipv4Addr;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

pub use handle::HmrHandle;
pub use manifest::{
    manifest_path, manifest_payload, write_manifest_extras, ManifestExtras, HMR_DIRECTORY,
};

use crate::error::Result;
use crate::hmr_server::connection::{accept_loop, ClientContext};
use crate::types::Port;

/// How often every client is pinged.
const PING_INTERVAL: Duration = Duration::from_secs(10);

/// Binds `127.0.0.1:<port>` and serves; returns once listening. The accept loop and every client
/// task end when `shutdown` is cancelled.
pub async fn serve(
    port: Port,
    output_dir: &Path,
    shutdown: CancellationToken,
) -> Result<HmrHandle> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port.get())).await?;
    Ok(serve_listener_pinging(
        listener,
        output_dir,
        shutdown,
        PING_INTERVAL,
    ))
}

/// Serves on an already bound listener with a custom ping interval: the seam integration tests
/// use with an ephemeral port, so they need not wait ten seconds.
pub fn serve_listener_pinging(
    listener: TcpListener,
    output_dir: &Path,
    shutdown: CancellationToken,
    ping_interval: Duration,
) -> HmrHandle {
    let handle = HmrHandle::new();
    let context = ClientContext {
        handle: handle.clone(),
        output_dir: Arc::from(output_dir),
        ping_interval,
    };
    tokio::spawn(accept_loop(listener, context, shutdown));
    handle
}
