//! Diffing two builds, planning the reload and describing its outcome.

mod describe;
mod plan;
mod snapshot;

pub(crate) use describe::{
    describe_background_swap, describe_extension_reload, describe_page_refresh,
    describe_postponed_reload, PageAction, RefreshedPage, TabUpdateResult,
};
pub(crate) use plan::{
    plan_reload, plan_stale_background_reload, BackgroundSwapPlan, ExtensionReloadPlan,
    PageRefreshPlan, ReloadPlan,
};
pub(crate) use snapshot::{take_build_snapshot, BuildSnapshot};

use super::error::{OutputError, Result};

/// Words a reload plan and its outcome in the one logged sentence of the dev server.
pub(crate) fn describe_reload(
    plan: &ReloadPlan,
    tab_result: &TabUpdateResult,
    refreshed_pages: &[RefreshedPage],
) -> Result<String> {
    match plan {
        ReloadPlan::None => Err(OutputError::Invalid(
            "a plan of kind none has no outcome".to_owned(),
        )),
        ReloadPlan::RefreshPages(refresh) => Ok(describe_page_refresh(refresh, refreshed_pages)),
        ReloadPlan::SwapBackground(swap) => Ok(describe_background_swap(swap, refreshed_pages)),
        ReloadPlan::ReloadExtension(reload) => Ok(describe_extension_reload(reload, tab_result)),
    }
}
