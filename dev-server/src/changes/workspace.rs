//! The file system as the orchestrator sees it.
//!
//! [`Workspace`] is the seam for every disk read and write of the hot loop: output hashing before
//! and after a build, copying public files into the output directory, the HMR manifest and its
//! extras, the installed lockfile. [`DiskWorkspace`] is the real implementation (blocking work
//! under `spawn_blocking`); the orchestrator's tests use an in-memory one.
//!
//! Ports the file helpers of the TypeScript dev server it replaced: `hashScriptOutputs`,
//! `hashMainWorldContentScripts`, `seedLocaleCatalogCache`, `logBuildOutcome`, and the reads and
//! writes of `applyResourceUpdate`.

use std::collections::BTreeMap;
use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;
use tokio::task::spawn_blocking;

use crate::changes::classifier::{
    hash_installed_lockfile, hash_main_world_content_scripts, hash_script_outputs,
    read_script_outputs, ScriptOutputs, LOCALES_SOURCE_PREFIX, LOCALE_MESSAGES_FILE_NAME,
};
use crate::changes::{read_optional, MANIFEST_FILE_NAME};
use crate::error::{Error, Result};
use crate::hmr_server::{manifest_payload, write_manifest_extras, ManifestExtras, HMR_DIRECTORY};
use crate::types::{ContentHash, RelPath};

/// Everything a build left in the output directory that decides what reloads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScriptSnapshot {
    /// The background and content-script outputs the manifest declares.
    pub outputs: ScriptOutputs,
    /// Content hash of each of those outputs that exists.
    pub hashes: BTreeMap<RelPath, ContentHash>,
    /// Hash of the MAIN-world content-script outputs.
    pub main_world: ContentHash,
}

/// What the build left behind, for the "Build artifacts OK" log line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuildArtifacts {
    /// Size of `manifest.json`.
    pub manifest_bytes: u64,
    /// Files under `hmr/`.
    pub hmr_file_count: usize,
}

/// Disk access of the hot loop.
pub trait Workspace: Send + Sync {
    /// Hashes the script outputs of the current build. Never fails on a missing manifest.
    fn script_snapshot(&self) -> impl Future<Output = Result<ScriptSnapshot>> + Send;
    /// A public source file's bytes, `None` when it no longer exists.
    fn read_public_file(
        &self,
        path: &RelPath,
    ) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send;
    /// An output file's bytes, `None` when absent. `relative` is output-relative.
    fn read_output(&self, relative: &str) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send;
    /// Writes an output file, creating its directories.
    fn write_output(
        &self,
        relative: &str,
        bytes: Vec<u8>,
    ) -> impl Future<Output = Result<()>> + Send;
    /// Adds the session extras to the built HMR manifest.
    fn write_manifest_extras(
        &self,
        extras: ManifestExtras,
    ) -> impl Future<Output = Result<()>> + Send;
    /// The HMR manifest push payload, `None` when the manifest does not exist.
    fn manifest_payload(&self) -> impl Future<Output = Result<Option<Arc<str>>>> + Send;
    /// Hash of the installed lockfile, `None` when absent.
    fn installed_lockfile_hash(&self) -> impl Future<Output = Result<Option<ContentHash>>> + Send;
    /// The parsed locale catalogs at startup, the baseline of the first diff.
    fn locale_catalogs(&self) -> impl Future<Output = Result<BTreeMap<RelPath, Value>>> + Send;
    /// The build's artifacts, `None` when `manifest.json` is missing.
    fn build_artifacts(&self) -> impl Future<Output = Result<Option<BuildArtifacts>>> + Send;
}

/// The real file system.
#[derive(Debug, Clone)]
pub struct DiskWorkspace {
    project_root: Arc<Path>,
    output_dir: Arc<Path>,
    installed_lockfile: Arc<Path>,
}

impl DiskWorkspace {
    /// A workspace over the project and its build output.
    pub fn new(project_root: PathBuf, output_dir: PathBuf, installed_lockfile: PathBuf) -> Self {
        Self {
            project_root: project_root.into(),
            output_dir: output_dir.into(),
            installed_lockfile: installed_lockfile.into(),
        }
    }
}

async fn blocking<T, F>(work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    spawn_blocking(work)
        .await
        .map_err(|error| Error::Io(std::io::Error::other(error)))?
}

fn snapshot_outputs(output_dir: &Path) -> Result<ScriptSnapshot> {
    let outputs = read_optional(&output_dir.join(MANIFEST_FILE_NAME))?
        .map(|bytes| read_script_outputs(&String::from_utf8_lossy(&bytes)))
        .transpose()?
        .unwrap_or_default();
    Ok(ScriptSnapshot {
        hashes: hash_script_outputs(output_dir, &outputs)?,
        main_world: hash_main_world_content_scripts(output_dir)?,
        outputs,
    })
}

fn count_files(directory: &Path) -> usize {
    let Ok(entries) = fs::read_dir(directory) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            1 + if path.is_dir() { count_files(&path) } else { 0 }
        })
        .sum()
}

fn read_locale_catalogs(project_root: &Path) -> BTreeMap<RelPath, Value> {
    let mut catalogs = BTreeMap::new();
    let locales_dir = project_root.join(LOCALES_SOURCE_PREFIX);
    let Ok(entries) = fs::read_dir(locales_dir) else {
        return catalogs;
    };
    for entry in entries.flatten() {
        let Some(language) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        let parsed = fs::read(entry.path().join(LOCALE_MESSAGES_FILE_NAME))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let Some(catalog) = parsed else {
            continue;
        };
        let relative = RelPath::new(format!(
            "{LOCALES_SOURCE_PREFIX}{language}/{LOCALE_MESSAGES_FILE_NAME}"
        ));
        catalogs.insert(relative, catalog);
    }
    catalogs
}

impl Workspace for DiskWorkspace {
    async fn script_snapshot(&self) -> Result<ScriptSnapshot> {
        let output_dir = Arc::clone(&self.output_dir);
        blocking(move || snapshot_outputs(&output_dir)).await
    }

    async fn read_public_file(&self, path: &RelPath) -> Result<Option<Vec<u8>>> {
        let absolute = self.project_root.join(path.as_str());
        blocking(move || read_optional(&absolute)).await
    }

    async fn read_output(&self, relative: &str) -> Result<Option<Vec<u8>>> {
        let absolute = self.output_dir.join(relative);
        blocking(move || read_optional(&absolute)).await
    }

    async fn write_output(&self, relative: &str, bytes: Vec<u8>) -> Result<()> {
        let absolute = self.output_dir.join(relative);
        blocking(move || {
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent)?;
            }
            Ok(fs::write(absolute, bytes)?)
        })
        .await
    }

    async fn write_manifest_extras(&self, extras: ManifestExtras) -> Result<()> {
        let output_dir = Arc::clone(&self.output_dir);
        blocking(move || write_manifest_extras(&output_dir, &extras)).await
    }

    async fn manifest_payload(&self) -> Result<Option<Arc<str>>> {
        let output_dir = Arc::clone(&self.output_dir);
        blocking(move || manifest_payload(&output_dir)).await
    }

    async fn installed_lockfile_hash(&self) -> Result<Option<ContentHash>> {
        let lockfile = Arc::clone(&self.installed_lockfile);
        blocking(move || hash_installed_lockfile(&lockfile)).await
    }

    async fn locale_catalogs(&self) -> Result<BTreeMap<RelPath, Value>> {
        let project_root = Arc::clone(&self.project_root);
        blocking(move || Ok(read_locale_catalogs(&project_root))).await
    }

    async fn build_artifacts(&self) -> Result<Option<BuildArtifacts>> {
        let output_dir = Arc::clone(&self.output_dir);
        blocking(move || {
            let Some(manifest) = read_optional(&output_dir.join(MANIFEST_FILE_NAME))? else {
                return Ok(None);
            };
            Ok(Some(BuildArtifacts {
                manifest_bytes: u64::try_from(manifest.len()).unwrap_or(u64::MAX),
                hmr_file_count: count_files(&output_dir.join(HMR_DIRECTORY)),
            }))
        })
        .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_missing_manifest_snapshots_as_empty() -> Result<()> {
        let directory = std::env::temp_dir().join("ytdl-workspace-missing");
        let workspace = DiskWorkspace::new(directory.clone(), directory.clone(), directory);
        let snapshot = workspace.script_snapshot().await?;
        assert!(snapshot.hashes.is_empty());
        assert_eq!(workspace.build_artifacts().await?, None);
        Ok(())
    }

    #[tokio::test]
    async fn written_output_reads_back() -> Result<()> {
        let directory = std::env::temp_dir().join(format!("ytdl-workspace-{}", std::process::id()));
        let workspace =
            DiskWorkspace::new(directory.clone(), directory.clone(), directory.join("lock"));
        workspace.write_output("img/a.png", b"x".to_vec()).await?;
        assert_eq!(
            workspace.read_output("img/a.png").await?,
            Some(b"x".to_vec())
        );
        assert_eq!(workspace.installed_lockfile_hash().await?, None);
        fs::remove_dir_all(directory)?;
        Ok(())
    }
}
