//! Which kind of edit a changed path is.

use std::collections::HashSet;

use crate::bridge::protocol::{HtmlEntrypoint, SidecarConfig};
use crate::types::RelPath;

use super::public_output_path;

/// What kind of edit a changed path is. Decides which latch it sets.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum PathClass {
    /// Under `src/public/`: copy and re-point, no build, no reload.
    PublicResource,
    /// A dotenv file of the build's cascade: rebuild, refresh env, reload.
    Env,
    /// The install marker; counts only if the installed dependency set changed.
    InstallMarker,
    /// Under an entrypoint this browser's build skips: ignore.
    SkippedEntrypoint,
    /// Under an HTML entrypoint: rebuild, reload only that entrypoint's pages.
    HtmlEntrypoint {
        /// The entrypoint's name.
        name: String,
    },
    /// In the HMR graph: hot-swap in place.
    HmrSource,
    /// Anything else: a full rebuild and reload.
    Code,
}

/// The lookup tables behind [`classify_path`], built from the config and refreshed with the HMR
/// graph after every `rebuildHmr`.
#[derive(Debug, Clone, Default)]
pub struct PathRules {
    /// The dotenv cascade.
    pub env_files: Vec<RelPath>,
    /// The install marker.
    pub install_marker: Option<RelPath>,
    /// Watch paths of skipped entrypoints.
    pub skipped_entrypoints: Vec<RelPath>,
    /// HTML entrypoints.
    pub html_entrypoints: Vec<HtmlEntrypoint>,
    /// The current HMR graph.
    pub hmr_sources: HashSet<RelPath>,
}

impl PathRules {
    /// The static part of the rules, from the sidecar config (the HMR graph starts empty).
    pub fn from_config(config: &SidecarConfig) -> Self {
        Self {
            env_files: config.env_files.clone(),
            install_marker: Some(config.install_marker.clone()),
            skipped_entrypoints: config.skipped_entrypoints.clone(),
            html_entrypoints: config.html_entrypoints.clone(),
            hmr_sources: HashSet::new(),
        }
    }
}

/// The class of one changed path. Order of precedence follows `scheduleRebuild`: install marker,
/// skipped entrypoint, public resource, env file, HMR source, HTML entrypoint, code.
///
/// ```
/// use ytdl_dev_hot::changes::classifier::{classify_path, PathClass, PathRules};
/// use ytdl_dev_hot::types::RelPath;
///
/// let rules = PathRules::default();
/// assert_eq!(classify_path(&rules, &RelPath::new("src/public/a.png")), PathClass::PublicResource);
/// assert_eq!(classify_path(&rules, &RelPath::new("src/lib/a.ts")), PathClass::Code);
/// ```
pub fn classify_path(rules: &PathRules, path: &RelPath) -> PathClass {
    if rules.install_marker.as_ref() == Some(path) {
        return PathClass::InstallMarker;
    }
    if rules
        .skipped_entrypoints
        .iter()
        .any(|watch_path| is_path_in_entrypoint(path, watch_path))
    {
        return PathClass::SkippedEntrypoint;
    }
    if public_output_path(path).is_some() {
        return PathClass::PublicResource;
    }
    if rules.env_files.contains(path) {
        return PathClass::Env;
    }
    if rules.hmr_sources.contains(path) {
        return PathClass::HmrSource;
    }
    rules
        .html_entrypoints
        .iter()
        .find(|entrypoint| is_path_in_entrypoint(path, &entrypoint.watch_path))
        .map_or(PathClass::Code, |entrypoint| PathClass::HtmlEntrypoint {
            name: entrypoint.name.clone(),
        })
}

/// Whether `path` is the entrypoint's source: inside the directory for a watch path ending in a
/// slash (a directory entrypoint), equal to it otherwise. Port of `isPathInEntrypoint`.
///
/// ```
/// use ytdl_dev_hot::changes::classifier::is_path_in_entrypoint;
/// use ytdl_dev_hot::types::RelPath;
///
/// let dir = RelPath::new("src/entrypoints/grant/");
/// assert!(is_path_in_entrypoint(&RelPath::new("src/entrypoints/grant/App.svelte"), &dir));
/// assert!(!is_path_in_entrypoint(&RelPath::new("src/entrypoints/grant2/a.ts"), &dir));
/// let file = RelPath::new("src/entrypoints/bridge.content.ts");
/// assert!(is_path_in_entrypoint(&file, &file));
/// ```
pub fn is_path_in_entrypoint(path: &RelPath, watch_path: &RelPath) -> bool {
    if watch_path.as_str().ends_with('/') {
        return path.as_str().starts_with(watch_path.as_str());
    }
    path == watch_path
}
