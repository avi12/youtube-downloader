//! The script outputs a build declares, and which of them a build effectively changed.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use crate::bridge::protocol::ChangedOutputs;
use crate::changes::{read_optional, MANIFEST_FILE_NAME};
use crate::error::Result;
use crate::types::{ContentHash, RelPath};

/// The background and content-script outputs a build's manifest declares.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ScriptOutputs {
    /// Background files (Chrome `service_worker`, Firefox `scripts[]`).
    pub background_files: Vec<RelPath>,
    /// Content-script js and css files.
    pub content_script_files: Vec<RelPath>,
}

#[derive(Deserialize)]
struct ManifestBackground {
    service_worker: Option<String>,
    #[serde(default)]
    scripts: Vec<String>,
}

/// The JavaScript world a content script runs in.
#[derive(Deserialize, PartialEq, Eq)]
enum ContentScriptWorld {
    /// The page's own world.
    #[serde(rename = "MAIN")]
    Main,
    /// `ISOLATED` or any other world.
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct ManifestContentScript {
    world: Option<ContentScriptWorld>,
    #[serde(default)]
    #[serde(rename = "js")]
    scripts: Vec<String>,
    #[serde(default)]
    css: Vec<String>,
}

impl ManifestContentScript {
    /// The script's js then css files.
    fn into_files(self) -> impl Iterator<Item = RelPath> {
        self.scripts.into_iter().chain(self.css).map(RelPath::new)
    }
}

#[derive(Deserialize)]
struct ExtensionManifest {
    background: Option<ManifestBackground>,
    #[serde(default)]
    content_scripts: Vec<ManifestContentScript>,
}

/// The part of the manifest [`main_world_script_files`] reads; the background is not parsed.
#[derive(Deserialize)]
struct ContentScriptsManifest {
    #[serde(default)]
    content_scripts: Vec<ManifestContentScript>,
}

/// Reads both background shapes and every content script from a manifest's JSON text.
/// Port of `readScriptOutputs`.
///
/// ```
/// use ytdl_dev_hot::changes::classifier::read_script_outputs;
///
/// let manifest = r#"{"background":{"service_worker":"bg.js"},"content_scripts":[{"js":["a.js"],"css":["a.css"]}]}"#;
/// let outputs = read_script_outputs(manifest)?;
/// assert_eq!(outputs.background_files.len(), 1);
/// assert_eq!(outputs.content_script_files.len(), 2);
/// # Ok::<(), ytdl_dev_hot::Error>(())
/// ```
pub fn read_script_outputs(manifest_json: &str) -> Result<ScriptOutputs> {
    let manifest: ExtensionManifest = serde_json::from_str(manifest_json)?;
    let background_files = manifest
        .background
        .into_iter()
        .flat_map(|background| {
            background
                .service_worker
                .into_iter()
                .chain(background.scripts)
        })
        .map(RelPath::new)
        .collect();
    let content_script_files = manifest
        .content_scripts
        .into_iter()
        .flat_map(ManifestContentScript::into_files)
        .collect();
    Ok(ScriptOutputs {
        background_files,
        content_script_files,
    })
}

/// Content hash of every declared script output that exists. Blocking: run under `spawn_blocking`.
/// Port of `hashScriptOutputs`; the caller reads `manifest.json` and passes the declared outputs.
pub fn hash_script_outputs(
    output_dir: &Path,
    outputs: &ScriptOutputs,
) -> Result<BTreeMap<RelPath, ContentHash>> {
    let mut hashes = BTreeMap::new();
    let files = outputs
        .background_files
        .iter()
        .chain(&outputs.content_script_files);
    for file in files {
        let Some(bytes) = read_optional(&output_dir.join(file.as_str()))? else {
            continue;
        };
        hashes.insert(file.clone(), ContentHash::from_bytes(&bytes));
    }
    Ok(hashes)
}

/// Compares output hashes before and after a build: only outputs whose bytes moved are changed.
/// Port of `classifyChangedOutputs` (the MAIN-world flag is filled by the caller from
/// [`hash_main_world_content_scripts`]).
///
/// ```
/// use std::collections::BTreeMap;
/// use ytdl_dev_hot::changes::classifier::{classify_changed_outputs, ScriptOutputs};
/// use ytdl_dev_hot::types::{ContentHash, RelPath};
///
/// let outputs = ScriptOutputs {
///     background_files: vec![RelPath::new("bg.js")],
///     content_script_files: vec![RelPath::new("cs.js")],
/// };
/// let before = BTreeMap::from([(RelPath::new("bg.js"), ContentHash::from_bytes(b"1")), (RelPath::new("cs.js"), ContentHash::from_bytes(b"1"))]);
/// let after = BTreeMap::from([(RelPath::new("bg.js"), ContentHash::from_bytes(b"1")), (RelPath::new("cs.js"), ContentHash::from_bytes(b"2"))]);
/// let changed = classify_changed_outputs(&outputs, &before, &after);
/// assert!(!changed.is_background_changed);
/// assert_eq!(changed.changed_content_script_files, vec![RelPath::new("cs.js")]);
/// ```
pub fn classify_changed_outputs(
    outputs: &ScriptOutputs,
    before: &BTreeMap<RelPath, ContentHash>,
    after: &BTreeMap<RelPath, ContentHash>,
) -> ChangedOutputs {
    let is_output_changed = |file: &&RelPath| after.get(*file) != before.get(*file);
    ChangedOutputs {
        is_background_changed: outputs
            .background_files
            .iter()
            .any(|file| is_output_changed(&file)),
        changed_content_script_files: outputs
            .content_script_files
            .iter()
            .filter(is_output_changed)
            .cloned()
            .collect(),
        is_main_world_content_script_changed: false,
    }
}

/// Hash of every `world: "MAIN"` content-script output, so an effective change flips it.
/// Blocking. Port of `hashMainWorldContentScripts`.
pub fn hash_main_world_content_scripts(output_dir: &Path) -> Result<ContentHash> {
    let Some(manifest) = read_optional(&output_dir.join(MANIFEST_FILE_NAME))? else {
        return Ok(ContentHash::from_bytes(&[]));
    };
    let manifest_text = String::from_utf8_lossy(&manifest);
    let mut material = Vec::new();
    for file in main_world_script_files(&manifest_text)? {
        let Some(bytes) = read_optional(&output_dir.join(file.as_str()))? else {
            continue;
        };
        material.extend_from_slice(file.as_str().as_bytes());
        material.extend_from_slice(&bytes);
    }
    Ok(ContentHash::from_bytes(&material))
}

/// The js and css files of every `world: "MAIN"` content script in a manifest's JSON text.
///
/// ```
/// use ytdl_dev_hot::changes::classifier::main_world_script_files;
///
/// let manifest = r#"{"content_scripts":[{"world":"MAIN","js":["m.js"]},{"js":["iso.js"]}]}"#;
/// assert_eq!(main_world_script_files(manifest)?.len(), 1);
/// # Ok::<(), ytdl_dev_hot::Error>(())
/// ```
pub fn main_world_script_files(manifest_json: &str) -> Result<Vec<RelPath>> {
    let manifest: ContentScriptsManifest = serde_json::from_str(manifest_json)?;
    Ok(manifest
        .content_scripts
        .into_iter()
        .filter(|script| script.world == Some(ContentScriptWorld::Main))
        .flat_map(ManifestContentScript::into_files)
        .collect())
}

#[cfg(test)]
mod tests {
    use crate::changes::classifier::outputs::*;

    #[test]
    fn firefox_scripts_array_is_read_as_background() -> Result<()> {
        let outputs = read_script_outputs(r#"{"background":{"scripts":["a.js","b.js"]}}"#)?;
        assert_eq!(outputs.background_files.len(), 2);
        Ok(())
    }

    #[test]
    fn a_manifest_without_scripts_is_empty() -> Result<()> {
        assert_eq!(read_script_outputs("{}")?, ScriptOutputs::default());
        Ok(())
    }

    #[test]
    fn a_missing_output_hash_counts_as_changed() {
        let outputs = ScriptOutputs {
            background_files: vec![RelPath::new("bg.js")],
            content_script_files: Vec::new(),
        };
        let after = BTreeMap::from([(RelPath::new("bg.js"), ContentHash::from_bytes(b"1"))]);
        assert!(classify_changed_outputs(&outputs, &BTreeMap::new(), &after).is_background_changed);
    }
}
