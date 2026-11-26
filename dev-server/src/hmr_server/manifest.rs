//! The HMR manifest file: the payload pushed to runtimes and the session extras merged into it.

use std::collections::BTreeMap;
use std::fs;
use std::io::ErrorKind;
use std::path::Path;
use std::sync::Arc;

use std::path::PathBuf;

use serde::Serialize;
use serde_json::{Map, Value};

use crate::changes::MANIFEST_FILE_NAME;
use crate::error::{Error, Result};
use crate::hmr_server::push::PushKind;

/// The directory of the HMR modules and their manifest, inside the output directory.
pub const HMR_DIRECTORY: &str = "hmr";
/// The extension of the temporary file a manifest rewrite goes through.
const TEMPORARY_EXTENSION: &str = "json.tmp";

/// The manifest file the runtime reads, under `output_dir`.
pub fn manifest_path(output_dir: &Path) -> PathBuf {
    output_dir.join(HMR_DIRECTORY).join(MANIFEST_FILE_NAME)
}

/// Session-wide edits that ride the HMR manifest, merged in under their camelCase names.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestExtras {
    /// The locale overlay: message key to its catalog entry.
    pub overlay: Map<String, Value>,
    /// Public path to the content version of every edited non-locale public file.
    pub resource_versions: BTreeMap<String, String>,
}

/// The manifest text, or `None` when the file does not exist (yet). Blocking.
fn read_manifest(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(raw) => Ok(Some(raw)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

/// The manifest payload text, or `None` when the manifest file does not exist (yet).
/// Port of `hmrManifestPayload`. Blocking read: run under `spawn_blocking`.
pub fn manifest_payload(output_dir: &Path) -> Result<Option<Arc<str>>> {
    let raw = read_manifest(&manifest_path(output_dir))?;
    Ok(raw.map(|raw| Arc::from(PushKind::manifest_payload(&raw))))
}

/// Adds the session extras to the built manifest, a no-op when the manifest does not exist.
/// Port of `writeHmrManifestExtras`. Blocking. The rewrite goes through a temporary file and a
/// rename, so the runtime's manifest poll never reads a half-written file.
pub fn write_manifest_extras(output_dir: &Path, extras: &ManifestExtras) -> Result<()> {
    let manifest_path = manifest_path(output_dir);
    let Some(raw) = read_manifest(&manifest_path)? else {
        return Ok(());
    };
    let mut manifest: Map<String, Value> = serde_json::from_str(&raw)?;
    let Value::Object(fields) = serde_json::to_value(extras)? else {
        return Err(Error::Protocol(
            "manifest extras must be a JSON object".into(),
        ));
    };
    manifest.extend(fields);
    let temporary_path = manifest_path.with_extension(TEMPORARY_EXTENSION);
    fs::write(&temporary_path, serde_json::to_vec(&manifest)?)?;
    fs::rename(&temporary_path, &manifest_path)?;
    Ok(())
}
