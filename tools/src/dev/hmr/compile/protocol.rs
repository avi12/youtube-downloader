//! The JSON lines the Rust side and the Node compile worker exchange: one job in, then request and
//! response lines while the build runs, then one result line.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::dev::hmr::analysis::wxt_resolution::{PathAlias, VirtualModules};
use crate::dev::hmr::chunks::BuildOutput;
use crate::dev::hmr::config::BuildBrowser;

/// What Vite is told about the build mode.
pub(super) const MODE_DEVELOPMENT: &str = "development";

/// One Vite build, as the worker is asked to run it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkerJob<'job> {
    pub(super) project_root: &'job str,
    pub(super) src_prefix: &'job str,
    pub(super) runtime_global: &'job str,
    pub(super) mode: &'static str,
    pub(super) browser: BuildBrowser,
    pub(super) output_directory: &'job str,
    pub(super) input: &'job BTreeMap<String, String>,
    pub(super) cache_epoch: u64,
    pub(super) aliases: &'job [PathAlias],
    pub(super) virtual_modules: &'job VirtualModules,
}

/// What the worker asks of the Rust side while it builds.
#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub(super) enum TransformRequest {
    /// The `$state` rewrite of a component's instance script.
    PreserveLocal { code: String, key: String },
    /// The `$state` adoption rewrite of a `.svelte.ts` module.
    PreserveModule { code: String, key: String },
    /// The auto-import lines a script is missing.
    AutoImports { code: String },
}

/// One line the worker writes.
#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub(super) enum WorkerMessage {
    /// A question the worker waits on.
    Request { id: u64, request: TransformRequest },
    /// The build finished.
    Done { output: BuildOutput },
    /// The build failed.
    Failed { message: String },
}

/// The answer to one request.
#[derive(Debug, Serialize)]
pub(super) struct TransformResponse {
    pub(super) id: u64,
    pub(super) code: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_line_parses() {
        let line =
            r#"{"type":"request","id":3,"request":{"op":"preserveLocal","code":"x","key":"k"}}"#;
        let message: WorkerMessage = serde_json::from_str(line).unwrap();
        assert!(matches!(
            message,
            WorkerMessage::Request {
                id: 3,
                request: TransformRequest::PreserveLocal { .. }
            }
        ));
    }

    #[test]
    fn a_done_line_without_modules_parses() {
        let line =
            r#"{"type":"done","output":{"chunks":[{"type":"asset","fileName":"assets/a.css"}]}}"#;
        let message: WorkerMessage = serde_json::from_str(line).unwrap();
        assert!(matches!(message, WorkerMessage::Done { .. }));
    }
}
