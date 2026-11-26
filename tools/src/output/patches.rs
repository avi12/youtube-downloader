//! What the dev server adds to its builds (never to `wxt build` or a release) so a hot-swap can
//! keep the `YouTube` page alive. Port of `scripts/dev/output/patches.ts`.

pub(crate) mod hmr_names;
mod sources;

use std::fs;
use std::path::Path;

use serde_json::{json, Map, Value};
use ytdl_dev_hot::types::ContentHash;

pub(crate) use sources::{recorder_source, replay_function_source};

use self::hmr_names::{
    HMR_MANIFEST_FILE, HMR_OUT_SUBDIR, HMR_POPUP_LOADER_FILE, HMR_RUNTIME_FILE, YOUTUBE_ENTRY_NAME,
};
use crate::output::error::{OutputError, Result};
use crate::output::manifest::{ExtensionManifest, MANIFEST_FILE};

const YOUTUBE_WAR_MATCH: &str = "*://*.youtube.com/*";
const CROSS_WORLD_RECORDER_FILE: &str = "dev/cross-world-recorder.js";
const MAIN_WORLD: &str = "MAIN";
const MODULE_SCRIPT_TYPE: &str = "type=\"module\"";
const SCRIPT_OPEN: &str = "<script";
const SCRIPT_CLOSE: &str = "</script>";
const BODY_CLOSE: &str = "</body>";

/// The built file each hot-swappable entrypoint's loader replaces.
enum HmrEntry {
    /// An HTML page whose module script is swapped for the popup loader.
    Page { built_file: &'static str },
    /// A content script whose bundle is replaced by a loader of the named HMR entry.
    ContentScript {
        name: &'static str,
        built_file: &'static str,
    },
}

const HMR_ENTRIES: [HmrEntry; 2] = [
    HmrEntry::Page {
        built_file: "popup.html",
    },
    HmrEntry::ContentScript {
        name: YOUTUBE_ENTRY_NAME,
        built_file: "content-scripts/youtube.js",
    },
];

fn source_hash(source: &str) -> String {
    ContentHash::from_bytes(source.as_bytes())
        .as_str()
        .to_owned()
}

fn read_text(path: &Path) -> Result<String> {
    fs::read_to_string(path).map_err(OutputError::with_path(path))
}

fn write_text(path: &Path, text: &str) -> Result<()> {
    fs::write(path, text).map_err(OutputError::with_path(path))
}

fn manifest_object(manifest: &mut Value) -> Result<&mut Map<String, Value>> {
    manifest
        .as_object_mut()
        .ok_or_else(|| OutputError::Invalid("manifest.json is not an object".to_owned()))
}

fn push_entry(manifest: &mut Map<String, Value>, key: &str, entry: Value) -> Result<()> {
    let list = manifest
        .entry(key)
        .or_insert_with(|| Value::Array(Vec::new()));
    let items = list
        .as_array_mut()
        .ok_or_else(|| OutputError::Invalid(format!("manifest key {key} is not an array")))?;
    items.push(entry);
    Ok(())
}

/// The recorder runs in the page itself from `document_start`, in every top frame the isolated
/// content scripts match, so it hears the MAIN-world script's first message.
fn recorder_content_script(manifest: &ExtensionManifest) -> Result<Value> {
    let mut matches: Vec<String> = Vec::new();
    for entry in manifest.list_isolated_content_scripts()? {
        for pattern in entry.matches {
            if !matches.contains(&pattern) {
                matches.push(pattern);
            }
        }
    }
    Ok(json!({
        "matches": matches,
        "js": [CROSS_WORLD_RECORDER_FILE],
        "run_at": "document_start",
        "world": MAIN_WORLD,
    }))
}

/// Adds the recorder content script and makes the HMR modules web-accessible to `YouTube`.
pub(crate) fn patch_manifest(output_dir: &Path) -> Result<()> {
    let mut manifest = ExtensionManifest::read(output_dir)?;
    let recorder = recorder_content_script(&manifest)?;
    let object = manifest_object(&mut manifest.0)?;
    push_entry(object, "content_scripts", recorder)?;
    let resources = json!({
        "resources": [format!("{HMR_OUT_SUBDIR}/*")],
        "matches": [YOUTUBE_WAR_MATCH],
    });
    push_entry(object, "web_accessible_resources", resources)?;
    write_text(
        &output_dir.join(MANIFEST_FILE),
        &serde_json::to_string_pretty(&manifest.0)?,
    )
}

/// Removes every `<script ... type="module" ...></script>` tag.
fn strip_module_scripts(html: &str) -> String {
    let mut kept = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find(SCRIPT_OPEN) {
        let (before, from_tag) = rest.split_at(start);
        kept.push_str(before);
        let after_name = from_tag.get(SCRIPT_OPEN.len()..).unwrap_or_default();
        let is_boundary = !after_name
            .starts_with(|character: char| character.is_alphanumeric() || character == '_');
        let tag_end = after_name.find('>').filter(|_| is_boundary);
        let Some(end) = tag_end else {
            kept.push_str(SCRIPT_OPEN);
            rest = after_name;
            continue;
        };
        let (attributes, tail) = after_name.split_at(end + 1);
        let is_module = attributes.contains(MODULE_SCRIPT_TYPE) && tail.starts_with(SCRIPT_CLOSE);
        if is_module {
            rest = tail.get(SCRIPT_CLOSE.len()..).unwrap_or_default();
            continue;
        }
        kept.push_str(SCRIPT_OPEN);
        kept.push_str(attributes);
        rest = tail;
    }
    kept.push_str(rest);
    kept
}

fn patch_popup_html(output_dir: &Path, built_file: &str) -> Result<()> {
    let html_path = output_dir.join(built_file);
    if !html_path.exists() {
        return Ok(());
    }
    let original = read_text(&html_path)?;
    let loader_tag = format!(
        "<script type=\"module\" src=\"/{HMR_OUT_SUBDIR}/{HMR_POPUP_LOADER_FILE}\"></script>"
    );
    let patched = strip_module_scripts(&original).replacen(
        BODY_CLOSE,
        &format!("{loader_tag}{BODY_CLOSE}"),
        1,
    );
    write_text(
        &html_path,
        &format!("{patched}<!-- {} -->\n", source_hash(&original)),
    )
}

/// The prelude goes first in the first background script, so it sees every registration the
/// background makes and a swap can undo them.
fn patch_background(output_dir: &Path, prelude: &str) -> Result<()> {
    let manifest = ExtensionManifest::read(output_dir)?;
    let Some(first_file) = manifest.background_files()?.into_iter().next() else {
        return Ok(());
    };
    let path = output_dir.join(first_file);
    write_text(&path, &format!("{prelude}{}", read_text(&path)?))
}

fn patch_content_script(output_dir: &Path, file: &str) -> Result<()> {
    let path = output_dir.join(file);
    let original = read_text(&path)?;
    let loader_entry = HMR_ENTRIES.iter().find_map(|entry| match entry {
        HmrEntry::ContentScript { name, built_file } if *built_file == file => Some(*name),
        HmrEntry::ContentScript { .. } | HmrEntry::Page { .. } => None,
    });
    let source = match loader_entry {
        Some(name) => sources::content_script_loader(
            name,
            &format!("{HMR_OUT_SUBDIR}/{HMR_RUNTIME_FILE}"),
            &format!("{HMR_OUT_SUBDIR}/{HMR_MANIFEST_FILE}"),
            &original,
            &source_hash(&original),
        ),
        None => original,
    };
    write_text(&path, &sources::guard_run_once(file, &source))
}

/// Runs once WXT has written the build: adds the background prelude and the recorder, points the
/// hot-swappable entrypoints at the HMR modules and guards every other content script.
pub(crate) fn patch_built_output(output_dir: &Path, background_prelude: &str) -> Result<()> {
    patch_background(output_dir, background_prelude)?;
    for entry in &HMR_ENTRIES {
        if let HmrEntry::Page { built_file } = entry {
            patch_popup_html(output_dir, built_file)?;
        }
    }
    let recorder_path = output_dir.join(CROSS_WORLD_RECORDER_FILE);
    if let Some(directory) = recorder_path.parent() {
        fs::create_dir_all(directory).map_err(OutputError::with_path(directory))?;
    }
    write_text(&recorder_path, &recorder_source())?;
    let manifest = ExtensionManifest::read(output_dir)?;
    let files = manifest
        .list_content_scripts()?
        .into_iter()
        .flat_map(|entry| entry.scripts);
    for file in files {
        patch_content_script(output_dir, &file)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::output::patches::*;

    #[test]
    fn only_module_scripts_are_stripped() {
        let html = r#"<head><script type="module" crossorigin src="a.js"></script><script src="b.js"></script><script type="module">x</script></head><body></body>"#;
        let stripped = strip_module_scripts(html);
        assert_eq!(
            stripped,
            r#"<head><script src="b.js"></script><script type="module">x</script></head><body></body>"#
        );
    }

    #[test]
    fn the_recorder_listens_on_every_isolated_match() -> Result<()> {
        let manifest = ExtensionManifest(json!({
            "content_scripts": [
                {"js": ["a.js"], "matches": ["*://*.youtube.com/*"]},
                {"js": ["b.js"], "matches": ["*://*.youtube.com/*", "*://music.youtube.com/*"]},
                {"js": ["m.js"], "world": "MAIN", "matches": ["*://other/*"]}
            ]
        }));
        let recorder = recorder_content_script(&manifest)?;
        assert_eq!(
            recorder.get("matches"),
            Some(&json!(["*://*.youtube.com/*", "*://music.youtube.com/*"]))
        );
        assert_eq!(recorder.get("world"), Some(&json!("MAIN")));
        Ok(())
    }

    #[test]
    fn patch_manifest_appends_the_dev_entries() -> Result<()> {
        let directory =
            std::env::temp_dir().join(format!("ytdl-patch-manifest-{}", std::process::id()));
        fs::create_dir_all(&directory).map_err(OutputError::with_path(&directory))?;
        let manifest = json!({"content_scripts": [{"js": ["a.js"], "matches": ["*://x/*"]}]});
        write_text(&directory.join(MANIFEST_FILE), &manifest.to_string())?;
        patch_manifest(&directory)?;
        let patched = ExtensionManifest::read(&directory)?;
        fs::remove_dir_all(&directory).map_err(OutputError::with_path(&directory))?;
        assert_eq!(patched.list_content_scripts()?.len(), 2);
        assert_eq!(
            patched.0.pointer("/web_accessible_resources/0/resources/0"),
            Some(&json!("hmr/*"))
        );
        Ok(())
    }
}
