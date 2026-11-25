//! What the dev-only HMR build and its loaders share: where the output lives, which entrypoints are
//! hot-swappable, and the manifest the in-page runtime polls.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Serialize;
use ytdl_dev_hot::types::ContentHash;

pub(crate) use crate::output::options::BuildBrowser;
pub(crate) use crate::output::patches::hmr_names::{
    HMR_MANIFEST_FILE, HMR_OUT_SUBDIR, HMR_POPUP_LOADER_FILE, HMR_RUNTIME_FILE, HMR_RUNTIME_GLOBAL,
    POPUP_ENTRY_NAME, YOUTUBE_ENTRY_NAME,
};

const SOURCE_ID_PREFIX: &str = "src/";
const SHORT_HASH_HEX_CHARS: usize = 12;

/// How an entrypoint is loaded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EntryKind {
    /// An HTML page whose script mounts components.
    Page,
    /// A content script, wrapped so its `main` runs from the loader.
    ContentScript,
}

/// One hot-swappable entrypoint.
#[derive(Debug, Clone, Copy)]
pub(crate) struct HmrEntry {
    pub(crate) name: &'static str,
    pub(crate) kind: EntryKind,
    pub(crate) source_path: &'static str,
}

/// Only extension code that mounts Svelte components can hot-swap. Background, MAIN-world scripts
/// and the offscreen document are not in this list, so an edit to them reloads like it always did.
pub(crate) const HMR_ENTRIES: [HmrEntry; 2] = [
    HmrEntry {
        name: POPUP_ENTRY_NAME,
        kind: EntryKind::Page,
        source_path: "src/layers/popup/entrypoints/popup/main.ts",
    },
    HmrEntry {
        name: YOUTUBE_ENTRY_NAME,
        kind: EntryKind::ContentScript,
        source_path: "src/layers/youtube/entrypoints/youtube.content/index.ts",
    },
];

/// One hot-swappable module of the manifest.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct ManifestModule {
    pub(crate) url: String,
    pub(crate) hash: String,
}

/// The global stylesheets one entrypoint's runtime re-applies in place.
#[derive(Debug, Clone, Serialize)]
pub(crate) struct ManifestStyles {
    pub(crate) urls: Vec<String>,
    pub(crate) hash: String,
}

/// The manifest the in-page runtime polls.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HmrManifest {
    pub(crate) entries: BTreeMap<String, String>,
    pub(crate) vendor_hash: String,
    pub(crate) modules: BTreeMap<String, ManifestModule>,
    pub(crate) styles: BTreeMap<String, ManifestStyles>,
    /// Module id to why editing it reloads the page, for modules the build analysed and rejected.
    pub(crate) reload_reasons: BTreeMap<String, String>,
    pub(crate) source_modules: Vec<String>,
    /// A change of it restarts the `YouTube` content script in place.
    pub(crate) restart_hash: String,
}

/// The first twelve hex digits of the SHA-256 of `content`: the cache-busting version of a module.
pub(crate) fn short_hash(content: &[u8]) -> String {
    ContentHash::from_bytes(content)
        .prefix(SHORT_HASH_HEX_CHARS)
        .to_owned()
}

/// Where the project and its `src/` live, in the forward-slash spelling Vite module ids use.
#[derive(Debug, Clone)]
pub(crate) struct ProjectPaths {
    root: String,
    src_prefix: String,
}

impl ProjectPaths {
    pub(crate) fn new(root: &Path) -> Self {
        let spelled = root.to_string_lossy().replace('\\', "/");
        let root = spelled.trim_end_matches('/').to_owned();
        let src_prefix = format!("{root}/src/");
        Self { root, src_prefix }
    }

    pub(crate) fn root(&self) -> &str {
        &self.root
    }

    pub(crate) fn src_prefix(&self) -> &str {
        &self.src_prefix
    }

    /// The absolute, forward-slash path of a project-relative one.
    pub(crate) fn absolute(&self, relative: &str) -> String {
        format!("{}/{relative}", self.root)
    }

    /// Whether a module path (query allowed) is a file under `src/`.
    pub(crate) fn is_source(&self, module_path: &str) -> bool {
        without_query(module_path)
            .replace('\\', "/")
            .starts_with(&self.src_prefix)
    }

    /// The project-relative `src/...` id of a module path, or `None` for anything outside `src/`.
    pub(crate) fn src_id_of(&self, module_path: &str) -> Option<String> {
        let spelled = without_query(module_path).replace('\\', "/");
        let rest = spelled.strip_prefix(&self.src_prefix)?;
        Some(format!("{SOURCE_ID_PREFIX}{rest}"))
    }
}

/// A module path without its `?query`.
pub(crate) fn without_query(module_path: &str) -> &str {
    module_path
        .split_once('?')
        .map_or(module_path, |(path, _)| path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_ids_are_project_relative() {
        let paths = ProjectPaths::new(Path::new(r"C:\repo"));
        assert_eq!(
            paths.src_id_of(r"C:\repo\src\a\b.svelte?x=1").as_deref(),
            Some("src/a/b.svelte")
        );
        assert_eq!(paths.src_id_of("C:/repo/node_modules/x.js"), None);
    }

    #[test]
    fn short_hash_is_twelve_hex_digits() {
        assert_eq!(short_hash(b"abc"), "ba7816bf8f01");
    }
}
