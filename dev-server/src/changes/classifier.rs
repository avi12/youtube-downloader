//! Pure change-classification logic: which kind of edit a path is, what a build effectively
//! changed, and what to do after a debounced batch. No I/O except [`hash_script_outputs`],
//! [`hash_main_world_content_scripts`] and [`hash_installed_lockfile`], which are blocking and
//! must run under `spawn_blocking`.
//!
//! Replaces, in the TypeScript dev server it replaced:
//! - `isEnvFile`, `isInstallChange`, `hashInstalledLockfile`, the `INSTALL_MARKER_PATH`
//!   handling (classification half of `scheduleRebuild`)
//! - `isPathInEntrypoint`, the skipped/html entrypoint matching in `scheduleRebuild`
//! - the pending latches (`pendingChange`, `isHmrOnlyPending`, `isFullReloadPending`,
//!   `isEnvChangePending`, `pendingHtmlEntrypoints`, `pendingResourceFiles`) and the branch structure
//!   of `scheduleRebuild` and `drainPendingRebuild` -> [`PendingState`] and [`plan_rebuild`]
//! - `readScriptOutputs`, `hashScriptOutputs`, `classifyChangedOutputs`, `hashMainWorldContentScripts`
//!   -> [`read_script_outputs`], [`hash_script_outputs`], [`classify_changed_outputs`],
//!   [`hash_main_world_content_scripts`]
//! - the pure half of `applyResourceUpdate` (`PUBLIC_SOURCE_PREFIX`, `RESOURCE_HASH_LENGTH`,
//!   `isLocaleFile`, `diffLocaleCatalog`, `diffLocaleFile`) -> [`public_output_path`],
//!   [`resource_version`], [`is_locale_file`], [`diff_locale_catalog`]
//!
//! The copy-to-output, locale overlay state and manifest writing of `applyResourceUpdate` belong
//! to the orchestrator and [`crate::hmr_server`]; this module only decides.

mod install;
mod outputs;
mod path;
mod pending;
mod resources;

pub use install::{hash_installed_lockfile, InstallGate};
pub use outputs::{
    classify_changed_outputs, hash_main_world_content_scripts, hash_script_outputs,
    main_world_script_files, read_script_outputs, ContentScriptWorld, ManifestContentScript,
    ScriptOutputs,
};
pub use path::{classify_path, is_path_in_entrypoint, PathClass, PathRules};
pub use pending::{plan_rebuild, PendingState, RebuildPlan};
pub use resources::{
    diff_locale_catalog, is_locale_file, plan_resource_update, public_output_path,
    resource_version, ResourceAction, LOCALES_SOURCE_PREFIX, LOCALE_MESSAGES_FILE_NAME,
    LOCALE_MESSAGE_FIELD, PUBLIC_SOURCE_PREFIX, RESOURCE_HASH_LENGTH,
};
