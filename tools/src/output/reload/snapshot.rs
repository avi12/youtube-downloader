//! A build output directory as content hashes plus its manifest.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use ytdl_dev_hot::types::ContentHash;

use crate::output::error::{OutputError, Result};
use crate::output::manifest::{ExtensionManifest, MANIFEST_FILE};
use crate::output::patches::hmr_names::HMR_OUT_SUBDIR;
use crate::output::patches::is_swappable_output;

/// Chrome writes its indexed DNR rulesets into the unpacked extension's own dir.
const BROWSER_METADATA_DIR_PREFIX: &str = "_metadata/";

/// Every output file's content hash, and the manifest it ships.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub(crate) struct BuildSnapshot {
    pub(crate) file_hashes: BTreeMap<String, String>,
    #[cfg_attr(test, ts(type = "unknown"))]
    pub(crate) manifest: ExtensionManifest,
    /// Page-world scripts built to replace their own run in an open tab.
    #[serde(default)]
    pub(crate) swappable_files: BTreeSet<String>,
}

fn is_snapshot_file(file: &str) -> bool {
    let hmr_prefix = format!("{HMR_OUT_SUBDIR}/");
    !file.starts_with(BROWSER_METADATA_DIR_PREFIX) && !file.starts_with(&hmr_prefix)
}

fn list_directory(directory: &Path) -> Result<Vec<fs::DirEntry>> {
    let entries = fs::read_dir(directory).map_err(OutputError::with_path(directory))?;
    entries
        .map(|entry| entry.map_err(OutputError::with_path(directory)))
        .collect()
}

fn list_output_files(output_directory: &Path) -> Result<Vec<String>> {
    let mut files = Vec::new();
    if !output_directory.exists() {
        return Ok(files);
    }
    let mut pending = vec![output_directory.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for entry in list_directory(&directory)? {
            let path = entry.path();
            let kind = entry.file_type().map_err(OutputError::with_path(&path))?;
            if kind.is_dir() {
                pending.push(path);
                continue;
            }
            let Ok(relative) = path.strip_prefix(output_directory) else {
                continue;
            };
            files.push(relative.to_string_lossy().replace('\\', "/"));
        }
    }
    files.retain(|file| is_snapshot_file(file));
    files.sort();
    Ok(files)
}

/// Hashes every output file (minus browser metadata and the HMR modules) and reads the manifest.
pub(crate) fn take_build_snapshot(output_directory: &Path) -> Result<BuildSnapshot> {
    let files = list_output_files(output_directory)?;
    let has_manifest = files.iter().any(|file| file == MANIFEST_FILE);
    let mut file_hashes = BTreeMap::new();
    let mut swappable_files = BTreeSet::new();
    for file in files {
        let path = output_directory.join(&file);
        let bytes = fs::read(&path).map_err(OutputError::with_path(&path))?;
        if is_swappable_output(&bytes) {
            swappable_files.insert(file.clone());
        }
        file_hashes.insert(file, ContentHash::from_bytes(&bytes).as_str().to_owned());
    }
    let manifest = if has_manifest {
        ExtensionManifest::read(output_directory)?
    } else {
        ExtensionManifest::default()
    };
    Ok(BuildSnapshot {
        file_hashes,
        manifest,
        swappable_files,
    })
}

#[cfg(test)]
mod tests {
    use crate::output::reload::snapshot::*;

    #[test]
    fn metadata_and_hmr_files_are_skipped() {
        assert!(is_snapshot_file("manifest.json"));
        assert!(!is_snapshot_file("_metadata/x.json"));
        assert!(!is_snapshot_file("hmr/runtime.js"));
        assert!(is_snapshot_file("hmr-like.js"));
    }

    #[test]
    fn a_missing_directory_is_an_empty_snapshot() -> Result<()> {
        let snapshot = take_build_snapshot(Path::new("definitely/not/here"))?;
        assert_eq!(snapshot, BuildSnapshot::default());
        Ok(())
    }
}
