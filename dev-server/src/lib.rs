//! Hot loop of the `YouTube` Downloader extension dev server, as a Rust sidecar.
//!
//! # Process model
//!
//! The TypeScript launcher (`scripts/dev*.ts`) keeps launching the browser through
//! web-ext-run, cloning profiles, running the first WXT build and the HMR module build. Once the
//! browser is up it spawns this crate's binary (`ytdl-dev-hot`) as a sidecar and sends one JSON
//! line on stdin: the [`bridge::protocol::SidecarConfig`]. From then on the sidecar owns the hot loop:
//! watching files, deciding what a change means, the HMR WebSocket push channel, and reloading
//! tabs and extension pages over CDP (Chromium) or RDP (Firefox).
//!
//! ```text
//!   TypeScript launcher                          ytdl-dev-hot (Rust)
//!   ------------------                           ------------------
//!   spawn + config line  --stdin-->              bridge::connect
//!                                                watcher -> classifier -> orchestrator
//!   buildExtension / rebuildHmr / reloadExtension / injectHmr / refreshEnv
//!                        <--stdout--  {id, method, params}      (Rust -> TS requests)
//!                        --stdin-->   {id, result | error}      (TS -> Rust responses)
//!                        --stdin-->   {notify: "shutdown"}
//!                        <--stdout--  {log: "..."}              (printed through logEvent)
//! ```
//!
//! What stays in TypeScript: launching browsers, profile cloning, the WXT build, the HMR module
//! build (Vite, rolldown, the Svelte compiler), `runner.reloadAllExtensions()`, `reloadDevEnv`, and
//! `scripts/dev/hmr/runtime/runtime.ts`, which runs inside the page. They are reached only through
//! [`bridge::Host`]. stdout is the bridge: nothing else may print to it; use `tracing`, which
//! [`bridge::logging`] turns into `log` lines.
//!
//! # Modules and what they replace
//!
//! Each module's own documentation lists the TypeScript functions it ports.
//!
//! - [`bridge::protocol`], [`types`], [`error`]: wire types, newtypes, the error enum
//! - [`bridge`]: JSON-lines RPC client ([`bridge::Host`] is the seam)
//! - [`bridge::logging`]: `tracing` to `log` lines
//! - [`changes::watcher`]: polling file watcher with debounce
//! - [`changes::classifier`]: pure classification and reload-decision logic
//! - [`hmr_server`]: WebSocket push channel and manifest payload
//! - [`driver`], [`driver::cdp`], [`driver::rdp`]: the browser reload seam and its two protocols
//! - [`changes::workspace`]: disk access behind a trait
//! - [`orchestrator`]: the `select!` main loop
//!
//! # Conventions
//!
//! No `unsafe`, no `unwrap`/`expect`/`panic` outside tests, errors are [`Error`] with `?`.
//! Channels are bounded, cancellation is a `CancellationToken`, blocking file and hash work runs
//! under `spawn_blocking`. Tests are deterministic: `tokio::time::pause`, never real sleeps.
//! Run one module's tests with `cargo test --manifest-path dev-server/Cargo.toml <module>::`.

pub mod bridge;
pub mod changes;
pub mod driver;
pub mod error;
pub mod hmr_server;
pub mod orchestrator;
pub mod types;

pub use error::{Error, Result};
