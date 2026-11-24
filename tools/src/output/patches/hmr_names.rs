//! The names the dev server's HMR build, runtime, loaders and manifest patches agree on: one home,
//! so the output diff, the patches, the payload and the HMR build never drift apart.

/// The HMR modules the dev server adds beside a build.
pub(crate) const HMR_OUT_SUBDIR: &str = "hmr";
/// The manifest the in-page runtime polls, inside the HMR subdirectory.
pub(crate) const HMR_MANIFEST_FILE: &str = "manifest.json";
/// The in-page runtime, inside the HMR subdirectory.
pub(crate) const HMR_RUNTIME_FILE: &str = "runtime.js";
/// The popup loader, inside the HMR subdirectory.
pub(crate) const HMR_POPUP_LOADER_FILE: &str = "popup-loader.js";
/// The manifest path as the runtime fetches it, relative to the extension root.
pub(crate) const HMR_MANIFEST_PATH: &str = "hmr/manifest.json";
/// How often the runtime polls the manifest.
pub(crate) const HMR_POLL_INTERVAL_MS: u32 = 250;
/// The global the runtime installs on `globalThis`.
pub(crate) const HMR_RUNTIME_GLOBAL: &str = "ytdlDevHmr";
/// The global that names the entry a loader is running.
pub(crate) const HMR_ENTRY_GLOBAL: &str = "ytdlDevHmrEntry";
/// The popup page's entry name.
pub(crate) const POPUP_ENTRY_NAME: &str = "popup";
/// The `YouTube` content script's entry name.
pub(crate) const YOUTUBE_ENTRY_NAME: &str = "youtube";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_path_joins_the_subdirectory_and_the_file() {
        assert_eq!(
            HMR_MANIFEST_PATH,
            format!("{HMR_OUT_SUBDIR}/{HMR_MANIFEST_FILE}")
        );
    }
}
