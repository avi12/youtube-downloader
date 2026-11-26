//! The wire types: the sidecar config and the JSON-lines bridge protocol.
//!
//! One JSON object per line, both directions, over the sidecar's stdio.
//!
//! Rust to TypeScript (stdout):
//! - request `{"id":1,"method":"buildExtension"}` or `{"id":2,"method":"reloadExtension","params":{...}}`
//! - log `{"log":"Hot-swapped (84ms)"}` which TypeScript prints through its `logEvent`
//!
//! TypeScript to Rust (stdin; the very first line is the [`SidecarConfig`]):
//! - response `{"id":1,"result":...}` or `{"id":1,"error":"message"}`
//! - notification `{"notify":"shutdown"}`

use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, Result};
use crate::types::{BrowserKind, Port, RelPath, RequestId};

/// An entrypoint backed by an HTML page (popup, iframed pages): an edit under it reloads only the
/// open pages of that entrypoint, never the `YouTube` tabs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct HtmlEntrypoint {
    /// The entrypoint name, as the extension frame is found by it.
    pub name: String,
    /// The source directory or file whose edits belong to this entrypoint.
    pub watch_path: RelPath,
}

/// Everything the launcher knows and the sidecar needs, sent as the first stdin line.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct SidecarConfig {
    /// The extension project directory (`PROJECT_ROOT` in `scripts/dev/project.ts`).
    pub project_root: PathBuf,
    /// The build output directory of this browser target.
    #[serde(rename = "outputDir")]
    pub output_directory: PathBuf,
    /// Chromium or Firefox.
    pub browser: BrowserKind,
    /// The CDP port (Chromium) or the RDP port (Firefox).
    pub debug_port: Port,
    /// The port the HMR push channel listens on, already free (the manifest bakes it in).
    pub hmr_port: Port,
    /// Project-relative files and directories to watch.
    pub watch_paths: Vec<RelPath>,
    /// The dotenv cascade for this build mode, project-relative.
    pub env_files: Vec<RelPath>,
    /// The install marker, project-relative (`bun.lock`).
    pub install_marker: RelPath,
    /// The installed-state lockfile; its hash tells a real install from a no-op.
    pub installed_lockfile: PathBuf,
    /// Watch paths of entrypoints this browser's build skips; edits there are ignored.
    pub skipped_entrypoints: Vec<RelPath>,
    /// HTML entrypoints of this build.
    pub html_entrypoints: Vec<HtmlEntrypoint>,
    /// The extension id, needed to find its pages over RDP (Firefox only).
    #[serde(default)]
    #[cfg_attr(test, ts(optional = nullable))]
    pub extension_id: Option<String>,
    /// The extension's internal UUID (Firefox only).
    #[serde(default)]
    #[cfg_attr(test, ts(optional = nullable))]
    pub extension_uuid: Option<String>,
    /// The HMR graph of the first build, so an edit to one of its files hot-swaps.
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<Vec<RelPath>>", optional))]
    pub hmr_source_files: Vec<RelPath>,
    /// Whether the sidecar shuts down once the browser stops answering (Firefox with a debug port).
    #[serde(default)]
    #[cfg_attr(test, ts(as = "Option<bool>", optional))]
    pub is_liveness_monitored: bool,
    /// Cadence of the steady HMR re-injection after the first one landed; `None` injects once.
    #[serde(default)]
    #[cfg_attr(test, ts(optional = nullable))]
    pub hmr_reinject_interval_ms: Option<u64>,
    /// Quiet time before a burst of edits is acted on.
    pub debounce_ms: u64,
    /// The polling watcher's interval.
    pub poll_interval_ms: u64,
}

/// What a build effectively changed, by output content hash. Mirrors `ChangedOutputs`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ChangedOutputs {
    /// A background script output moved.
    pub is_background_changed: bool,
    /// The content-script outputs (js and css) whose bytes moved.
    pub changed_content_script_files: Vec<RelPath>,
    /// A MAIN-world content script moved, so a full page reload is needed.
    pub is_main_world_content_script_changed: bool,
}

/// The entrypoint layout a WXT build resolved (its `entrypoints:resolved` hook): which pages are
/// HTML and which entrypoints this browser's build skips. Sent back by `buildExtension`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct EntrypointLayout {
    /// HTML entrypoints of the build.
    pub html_entrypoints: Vec<HtmlEntrypoint>,
    /// Watch paths of the entrypoints the build skips.
    pub skipped_entrypoints: Vec<RelPath>,
}

/// Parameters of `reloadExtension`: the TypeScript side calls `runner.reloadAllExtensions()` and
/// whatever browser-specific step belongs to the change; the tab and page reloads are Rust's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct ReloadExtensionParams {
    /// What the build changed.
    pub changed: ChangedOutputs,
    /// When the change was first seen, in epoch milliseconds, for the "(Nms)" log line.
    pub started_at_ms: u64,
}

/// Result of `rebuildHmr`: the HMR graph after the rebuild, which decides whether a
/// later edit hot-swaps in place (the `hmrSourceModules` set of `scripts/dev/hmr/compile/build.ts`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(rename_all = "camelCase")]
pub struct RebuildHmrResult {
    /// Project-relative source files of the HMR graph.
    pub hmr_source_files: Vec<RelPath>,
}

/// Operations that must stay in TypeScript. Result types: `buildExtension` an optional [`EntrypointLayout`], `rebuildHmr`
/// [`RebuildHmrResult`], `reloadExtension` null, `injectHmr` a boolean (injected), `refreshEnv` null.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(tag = "method", content = "params", rename_all = "camelCase")]
#[non_exhaustive]
pub enum HostRequest {
    /// `buildExtension` (WXT) with the fs-retry wrapper.
    BuildExtension,
    /// `rebuildHmrAndPatch` (`scripts/dev/hmr/compile/build.ts`).
    RebuildHmr,
    /// `target.handleScriptReload` minus the tab reloads Rust now does.
    ReloadExtension(ReloadExtensionParams),
    /// `target.injectHmr` (a no-op today: the dev build loads the runtime itself, see `scripts/dev/output/patches.ts`).
    InjectHmr,
    /// `reloadDevEnv()` (`scripts/dev/server/sidecar.ts`): refresh `process.env` before an env-triggered rebuild.
    RefreshEnv,
}

/// A request line with its id.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct RequestEnvelope {
    /// Echoed by the matching response.
    pub id: RequestId,
    /// The operation and its parameters.
    #[serde(flatten)]
    pub request: HostRequest,
}

/// A log line for TypeScript to print.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct LogLine {
    /// The text, without a trailing newline.
    pub log: String,
}

/// Everything the sidecar writes to stdout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(untagged)]
#[non_exhaustive]
pub enum OutboundMessage {
    /// A request for TypeScript.
    Request(RequestEnvelope),
    /// A log line.
    Log(LogLine),
}

/// A response line: exactly one of `result` and `error` is meaningful; a missing or null result is
/// a void success.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Response {
    /// The id of the request being answered.
    pub id: RequestId,
    /// The success value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    /// The failure message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    /// The value, or [`Error::Host`] for an error response.
    pub fn into_result(self) -> Result<Value> {
        match self.error {
            Some(message) => Err(Error::Host { message }),
            None => Ok(self.result.unwrap_or(Value::Null)),
        }
    }
}

/// A one-way message from TypeScript.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(tag = "notify", rename_all = "camelCase")]
#[non_exhaustive]
pub enum Notification {
    /// Stop everything, flush, exit.
    Shutdown,
}

/// Everything the sidecar reads from stdin after the config line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[serde(untagged)]
#[non_exhaustive]
pub enum InboundMessage {
    /// A one-way message.
    Notification(Notification),
    /// The answer to a request.
    Response(Response),
}

/// One JSON line, newline included.
pub fn encode_line<T: Serialize>(message: &T) -> Result<String> {
    let mut line = serde_json::to_string(message)?;
    line.push('\n');
    Ok(line)
}

/// Parses one JSON line.
pub fn decode_line<T: DeserializeOwned>(line: &str) -> Result<T> {
    Ok(serde_json::from_str(line.trim_end())?)
}

#[cfg(test)]
mod bindings;
#[cfg(test)]
mod tests;
