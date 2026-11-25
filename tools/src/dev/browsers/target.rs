//! The contract between the dev server and a browser target: what a target must be able to do.
//! Port of the `ReloadTarget` interface of `scripts/dev/browsers/reload-actions.ts`.

use std::future::Future;
use std::pin::Pin;

use serde_json::Value;

use super::error::Result;
use crate::output::reload::{ExtensionReloadPlan, PageRefreshPlan, RefreshedPage, TabUpdateResult};

/// A boxed future, so a target can sit behind `dyn ReloadTarget`.
pub(crate) type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

/// What a Chrome or Firefox target can do to the extension under development.
pub(crate) trait ReloadTarget: Send + Sync {
    /// Reloads the extension, re-runs the ISOLATED content scripts in the open tabs in place and
    /// reports the tabs a changed MAIN-world script runs in as stale.
    fn reload_extension<'a>(
        &'a self,
        plan: &'a ExtensionReloadPlan,
    ) -> BoxFuture<'a, TabUpdateResult>;

    /// Refreshes the open extension pages an HTML-only change touched, leaving the extension and
    /// the tabs alone.
    fn refresh_pages<'a>(&'a self, plan: &'a PageRefreshPlan) -> BoxFuture<'a, Vec<RefreshedPage>>;

    /// Evaluates an expression that resolves to a JSON value in the extension's background.
    fn evaluate_in_background<'a>(&'a self, expression: &'a str) -> BoxFuture<'a, Value>;

    /// Runs a whole classic script in the background's global scope: the rebuilt background on a swap.
    fn run_script_in_background<'a>(&'a self, script: &'a str) -> BoxFuture<'a, ()>;
}
