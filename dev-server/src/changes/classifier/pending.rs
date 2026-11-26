//! The latches of a debounce window and the plan they drain into.

use std::collections::BTreeSet;

use crate::types::RelPath;

use crate::changes::classifier::PathClass;

/// The latches of a debounce window, mirroring the TypeScript `pending*` variables.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PendingState {
    /// A non-resource edit is pending (`pendingChange !== undefined`).
    pub has_code_change: bool,
    /// Only HMR-graph files changed so far (`isHmrOnlyPending`).
    pub is_hmr_only: bool,
    /// A non-HMR, non-HTML edit forces a full reload (`isFullReloadPending`).
    pub is_full_reload: bool,
    /// An env file changed (`isEnvChangePending`).
    pub is_env_change: bool,
    /// HTML entrypoints to reload (`pendingHtmlEntrypoints`).
    pub html_entrypoints: BTreeSet<String>,
    /// Public files to apply (`pendingResourceFiles`).
    pub resource_files: BTreeSet<RelPath>,
}

impl PendingState {
    /// Folds one classified edit into the latches. Resources never touch the rebuild latches; a
    /// coalesced env edit must not be downgraded by a later HMR-only edit.
    ///
    /// A [`PathClass::InstallMarker`] is treated as a code edit: the caller has already passed it
    /// through [`InstallGate`](super::InstallGate) and drops it when the dependency set did not change.
    pub fn record(&mut self, path: &RelPath, class: &PathClass) {
        match class {
            PathClass::SkippedEntrypoint => return,
            PathClass::PublicResource => {
                self.resource_files.insert(path.clone());
                return;
            }
            _ => {}
        }
        self.has_code_change = true;
        if matches!(class, PathClass::Env) {
            self.is_env_change = true;
        }
        if matches!(class, PathClass::HmrSource) && !self.is_full_reload {
            self.is_hmr_only = true;
            return;
        }
        self.is_hmr_only = false;
        match class {
            PathClass::HtmlEntrypoint { name } if !self.is_full_reload => {
                self.html_entrypoints.insert(name.clone());
            }
            PathClass::HtmlEntrypoint { .. } => {}
            _ => {
                self.is_full_reload = true;
                self.html_entrypoints.clear();
            }
        }
    }

    /// Whether nothing at all is pending.
    pub fn is_empty(&self) -> bool {
        !self.has_code_change && self.resource_files.is_empty()
    }

    /// Hands the window's latches to the drain and resets them (the `pending* = ...` block of
    /// `drainPendingRebuild`).
    #[must_use]
    pub fn take(&mut self) -> Self {
        std::mem::take(self)
    }
}

/// What to do for one drained window (the branches of `rebuildAndReload` and `drainPendingRebuild`).
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum RebuildPlan {
    /// Only public resources changed: apply them, no build.
    ResourcesOnly {
        /// The files to apply.
        files: BTreeSet<RelPath>,
    },
    /// Only HMR-graph files changed: `rebuildHmr`, push the manifest, no reload.
    HotSwap {
        /// Public files that rode along.
        resources: BTreeSet<RelPath>,
    },
    /// Only HTML entrypoints changed: build, reload just their pages.
    HtmlPages {
        /// The entrypoint names.
        entrypoints: BTreeSet<String>,
        /// Public files that rode along.
        resources: BTreeSet<RelPath>,
    },
    /// Build and reload what the output hashes say changed.
    Full {
        /// Refresh the environment first.
        is_env_change: bool,
        /// Public files that rode along.
        resources: BTreeSet<RelPath>,
    },
}

/// Turns a window's latches into a plan; `None` when nothing is pending.
///
/// ```
/// use ytdl_dev_hot::changes::classifier::{plan_rebuild, PathClass, PendingState, RebuildPlan};
/// use ytdl_dev_hot::types::RelPath;
///
/// let mut state = PendingState::default();
/// assert_eq!(plan_rebuild(&state), None);
/// state.record(&RelPath::new("src/a.ts"), &PathClass::HmrSource);
/// assert!(matches!(plan_rebuild(&state), Some(RebuildPlan::HotSwap { .. })));
/// ```
pub fn plan_rebuild(state: &PendingState) -> Option<RebuildPlan> {
    let resources = state.resource_files.clone();
    if !state.has_code_change {
        return (!resources.is_empty()).then_some(RebuildPlan::ResourcesOnly { files: resources });
    }
    if state.is_hmr_only {
        return Some(RebuildPlan::HotSwap { resources });
    }
    if state.is_full_reload {
        return Some(RebuildPlan::Full {
            is_env_change: state.is_env_change,
            resources,
        });
    }
    Some(RebuildPlan::HtmlPages {
        entrypoints: state.html_entrypoints.clone(),
        resources,
    })
}
