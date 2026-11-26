//! The built manifest as the dev tooling reads it: content scripts per world, background files and
//! match patterns. Background files come from the sidecar's `read_script_outputs`.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use ytdl_dev_hot::changes::classifier::read_script_outputs;

use crate::output::error::{OutputError, Result};

pub(crate) const MANIFEST_FILE: &str = "manifest.json";
const JS_EXTENSION: &str = ".js";
const ALL_URLS_PATTERN: &str = "<all_urls>";
const ANY_HOST: &str = "*";
const ANY_SUBDOMAIN_PREFIX: &str = "*.";
const SCHEME_SEPARATOR: &str = "://";
const PATTERN_SCHEMES: [&str; 7] = ["*", "http", "https", "ws", "wss", "file", "ftp"];
const ANY_WEB_SCHEMES: [&str; 2] = ["http", "https"];
const CONTENT_SCRIPTS_KEY: &str = "content_scripts";
const GECKO_ID_POINTER: &str = "/browser_specific_settings/gecko/id";

/// The JavaScript world a content script runs in; anything but `MAIN` is isolated.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub(crate) enum ContentScriptWorld {
    /// The page's world.
    Main,
    /// The extension's own world.
    #[default]
    #[serde(other)]
    Isolated,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawContentScript {
    matches: Vec<String>,
    #[serde(rename = "js")]
    scripts: Vec<String>,
    css: Vec<String>,
    world: ContentScriptWorld,
    all_frames: bool,
}

/// One manifest content script with the WXT entrypoint name of each js file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export))]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentScriptEntry {
    pub(crate) names: Vec<String>,
    pub(crate) world: ContentScriptWorld,
    pub(crate) matches: Vec<String>,
    #[serde(rename = "js")]
    pub(crate) scripts: Vec<String>,
    pub(crate) css: Vec<String>,
    pub(crate) is_all_frames: bool,
}

impl ContentScriptEntry {
    pub(crate) fn is_main_world(&self) -> bool {
        self.world == ContentScriptWorld::Main
    }
}

impl From<RawContentScript> for ContentScriptEntry {
    fn from(raw: RawContentScript) -> Self {
        let names = raw
            .scripts
            .iter()
            .map(|file| {
                let name = file.rsplit('/').next().unwrap_or(file);
                name.strip_suffix(JS_EXTENSION).unwrap_or(name).to_owned()
            })
            .collect();
        Self {
            names,
            world: raw.world,
            matches: raw.matches,
            scripts: raw.scripts,
            css: raw.css,
            is_all_frames: raw.all_frames,
        }
    }
}

/// The parsed `manifest.json`, kept as JSON so unknown keys survive.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(transparent)]
pub(crate) struct ExtensionManifest(pub(crate) Value);

impl Default for ExtensionManifest {
    fn default() -> Self {
        Self(Value::Object(Map::new()))
    }
}

impl ExtensionManifest {
    pub(crate) fn read(output_directory: &Path) -> Result<Self> {
        let path = output_directory.join(MANIFEST_FILE);
        let text = fs::read_to_string(&path).map_err(OutputError::with_path(&path))?;
        Ok(Self(serde_json::from_str(&text)?))
    }

    /// Firefox's runtime id and RDP's add-on id; empty when the manifest has none.
    pub(crate) fn gecko_id(&self) -> String {
        let id = self.0.pointer(GECKO_ID_POINTER).and_then(Value::as_str);
        id.unwrap_or_default().to_owned()
    }

    pub(crate) fn content_scripts_value(&self) -> Option<&Value> {
        self.0.get(CONTENT_SCRIPTS_KEY)
    }

    pub(crate) fn list_content_scripts(&self) -> Result<Vec<ContentScriptEntry>> {
        let Some(value) = self.content_scripts_value() else {
            return Ok(Vec::new());
        };
        let raw = Vec::<RawContentScript>::deserialize(value)?;
        Ok(raw.into_iter().map(ContentScriptEntry::from).collect())
    }

    pub(crate) fn list_isolated_content_scripts(&self) -> Result<Vec<ContentScriptEntry>> {
        let mut entries = self.list_content_scripts()?;
        entries.retain(|entry| !entry.is_main_world());
        Ok(entries)
    }

    pub(crate) fn background_files(&self) -> Result<Vec<String>> {
        let outputs = read_script_outputs(&self.0.to_string())?;
        let files = outputs.background_files;
        Ok(files.iter().map(|file| file.as_str().to_owned()).collect())
    }
}

/// The distinct entrypoint names of some content scripts, in first-seen order.
pub(crate) fn describe_content_scripts(entries: &[ContentScriptEntry]) -> String {
    let mut names: Vec<&str> = Vec::new();
    for name in entries.iter().flat_map(|entry| &entry.names) {
        if !names.contains(&name.as_str()) {
            names.push(name);
        }
    }
    names.join(", ")
}

/// Whether `glob` (where `*` is any run of characters) matches the whole `text`.
fn glob_matches(glob: &str, text: &str) -> bool {
    let Some(rest) = glob.strip_prefix('*') else {
        let Some(first) = glob.chars().next() else {
            return text.is_empty();
        };
        let Some(text_rest) = text.strip_prefix(first) else {
            return false;
        };
        return glob_matches(glob.get(first.len_utf8()..).unwrap_or_default(), text_rest);
    };
    let starts = text.char_indices().map(|(offset, _)| offset);
    starts
        .chain(Some(text.len()))
        .any(|offset| glob_matches(rest, text.get(offset..).unwrap_or_default()))
}

fn is_host_matching(pattern_host: &str, host: &str) -> bool {
    if pattern_host == ANY_HOST {
        return !host.is_empty();
    }
    let Some(base) = pattern_host.strip_prefix(ANY_SUBDOMAIN_PREFIX) else {
        return pattern_host == host;
    };
    host == base || host.ends_with(&format!(".{base}"))
}

fn is_scheme_matching(pattern_scheme: &str, scheme: &str) -> bool {
    if pattern_scheme == ANY_HOST {
        return ANY_WEB_SCHEMES.contains(&scheme);
    }
    pattern_scheme == scheme
}

/// Splits `scheme://host/path` into its three parts; the path keeps its leading slash.
fn split_url(text: &str) -> Option<(&str, &str, &str)> {
    let (scheme, rest) = text.split_once(SCHEME_SEPARATOR)?;
    let path_start = rest.find('/')?;
    let (host, path) = rest.split_at(path_start);
    Some((scheme, host, path))
}

/// A manifest match pattern as a test on a URL, for picking CDP page targets.
pub(crate) fn matches_url_pattern(url: &str, pattern: &str) -> bool {
    let parsed = split_url(pattern).filter(|(scheme, _, _)| PATTERN_SCHEMES.contains(scheme));
    let Some((pattern_scheme, pattern_host, pattern_path)) = parsed else {
        return pattern == ALL_URLS_PATTERN;
    };
    let Some((scheme, host, path)) = split_url(url) else {
        return false;
    };
    is_scheme_matching(pattern_scheme, scheme)
        && is_host_matching(pattern_host, host)
        && glob_matches(pattern_path, path)
}

#[cfg(test)]
mod tests {
    use crate::output::manifest::*;

    #[test]
    fn subdomain_wildcard_matches_bare_and_nested_hosts() {
        let pattern = "*://*.youtube.com/*";
        assert!(matches_url_pattern(
            "https://youtube.com/watch?v=1",
            pattern
        ));
        assert!(matches_url_pattern("http://music.youtube.com/a", pattern));
        assert!(!matches_url_pattern("https://notyoutube.com/a", pattern));
        assert!(!matches_url_pattern("ftp://youtube.com/a", pattern));
    }

    #[test]
    fn paths_and_all_urls() {
        assert!(matches_url_pattern(
            "https://a.com/x/y",
            "https://a.com/x/*"
        ));
        assert!(!matches_url_pattern("https://a.com/z", "https://a.com/x/*"));
        assert!(matches_url_pattern("anything", "<all_urls>"));
        assert!(!matches_url_pattern("anything", "nonsense"));
    }

    #[test]
    fn content_scripts_get_names_and_defaults() -> Result<()> {
        let manifest = ExtensionManifest(serde_json::json!({
            "content_scripts": [
                {"js": ["content-scripts/youtube.js"], "world": "MAIN", "matches": ["*://*/*"]},
                {"js": ["a.js"], "css": ["a.css"], "all_frames": true}
            ],
            "background": {"service_worker": "bg.js"},
            "browser_specific_settings": {"gecko": {"id": "x@y"}}
        }));
        let entries = manifest.list_content_scripts()?;
        assert_eq!(
            entries.first().map(|entry| entry.names.clone()),
            Some(vec!["youtube".to_owned()])
        );
        assert!(entries
            .first()
            .is_some_and(ContentScriptEntry::is_main_world));
        assert_eq!(entries.get(1).map(|entry| entry.is_all_frames), Some(true));
        assert_eq!(manifest.background_files()?, vec!["bg.js".to_owned()]);
        assert_eq!(manifest.gecko_id(), "x@y");
        assert_eq!(describe_content_scripts(&entries), "youtube, a");
        Ok(())
    }
}
