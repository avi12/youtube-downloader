//! Which source files an edit can hot-swap, and why the others reload the page.

pub(super) mod hot_sources;
mod reasons;
pub(super) mod side_effects;
pub(super) mod wxt_resolution;
