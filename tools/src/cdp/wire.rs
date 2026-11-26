//! The shared CDP plumbing of the group: one WebSocket session, the debug port's HTTP endpoints,
//! target selection and the console-event rendering.

mod error;
mod events;
mod http;
mod session;
mod targets;

pub(crate) use ytdl_dev_hot::driver::cdp::protocol::{Method, NoParams};

pub(crate) use self::error::{CdpError, Result};
pub(crate) use self::events::{render, ContextKind, Style, DUMP, MONITOR, SW_LOGS};
pub(crate) use self::http::{browser_websocket_url, close_target, open_tab};
pub(crate) use self::session::{evaluate_on, ContextEvaluation, RemoteObject, Session};
pub(crate) use self::targets::{open_target, PortArg, Targets, Wanted, EXTENSION_ID};

/// The parameters of `Page.reload`.
#[derive(Debug, Clone, Copy, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReloadParams {
    ignore_cache: bool,
}

impl ReloadParams {
    /// A reload that keeps the cache.
    pub(crate) const KEEPING_CACHE: Self = Self {
        ignore_cache: false,
    };
}

/// Prints a JSON value indented, as the scripts' `JSON.stringify(value, null, 2)` did.
pub(crate) fn print_json(value: &serde_json::Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}
