//! Per-module versions: a change bubbles through plain dependencies up to the nearest component, and
//! version-stamped imports make a re-import fetch exactly what changed.

use std::collections::{BTreeMap, BTreeSet};

use regex::{Captures, Regex};

use crate::dev::hmr::chunks::{ChunkType, OutputChunk};
use crate::dev::hmr::config::{short_hash, without_query, ProjectPaths};
use crate::dev::hmr::error::Result;

const ALTERNATIVE_NAME_GROUP: usize = 3;

const SVELTE_EXTENSION: &str = ".svelte";
const NO_VERSION: &str = "0";
const VENDOR_PATH_SEPARATOR: &str = "|";
const VENDOR_ENTRY_TERMINATOR: u8 = 0;
/// A relative `from "./x"`, `import("./x")` or `import "./x"` specifier, in either quote style.
const RELATIVE_IMPORT_PATTERN: &str = r#"((?-u:\b)from\s*|(?-u:\b)import\s*\(\s*|(?-u:\b)import\s*)(?:"(\.\.?/[^"']+)"|'(\.\.?/[^"']+)')"#;

/// One code chunk as the version computation sees it.
#[derive(Debug, Clone)]
pub(super) struct HmrChunk {
    pub(super) code: String,
    pub(super) source_hash: String,
    pub(super) is_svelte: bool,
    pub(super) is_vendor: bool,
    pub(super) dependencies: Vec<String>,
}

/// A dependency chunk's hash covers its module PATHS only: `node_modules` never changes in a session.
fn vendor_chunk_hash(module_ids: &[String], fallback_code: &str) -> String {
    let mut paths: Vec<String> = module_ids
        .iter()
        .map(|id| without_query(id).replace('\\', "/"))
        .collect();
    paths.sort();
    if paths.is_empty() {
        return short_hash(fallback_code.as_bytes());
    }
    short_hash(paths.join(VENDOR_PATH_SEPARATOR).as_bytes())
}

/// Describes every code chunk; `codes` holds what the bundler wrote for each file name.
pub(super) fn describe_chunks(
    paths: &ProjectPaths,
    chunks: &[OutputChunk],
    codes: &BTreeMap<String, String>,
) -> BTreeMap<String, HmrChunk> {
    let mut by_file_name = BTreeMap::new();
    for chunk in chunks.iter().filter(|chunk| chunk.kind == ChunkType::Chunk) {
        let code = codes.get(&chunk.file_name).cloned().unwrap_or_default();
        let is_vendor = chunk.module_ids.iter().all(|id| !paths.is_source(id));
        let source_hash = if is_vendor {
            vendor_chunk_hash(&chunk.module_ids, &code)
        } else {
            short_hash(code.as_bytes())
        };
        by_file_name.insert(
            chunk.file_name.clone(),
            HmrChunk {
                is_svelte: chunk
                    .facade_module_id
                    .as_deref()
                    .is_some_and(|id| id.ends_with(SVELTE_EXTENSION)),
                dependencies: chunk.dependencies().cloned().collect(),
                code,
                source_hash,
                is_vendor,
            },
        );
    }
    by_file_name
}

fn version_of(
    chunks: &BTreeMap<String, HmrChunk>,
    versions: &mut BTreeMap<String, String>,
    visiting: &mut BTreeSet<String>,
    file_name: &str,
) -> String {
    if let Some(cached) = versions.get(file_name) {
        return cached.clone();
    }
    let Some(chunk) = chunks.get(file_name) else {
        return NO_VERSION.to_owned();
    };
    if !visiting.insert(file_name.to_owned()) {
        return chunk.source_hash.clone();
    }
    let mut parts = vec![chunk.source_hash.clone()];
    for dependency in &chunk.dependencies {
        if chunks.get(dependency).is_some_and(|found| found.is_svelte) {
            continue;
        }
        parts.push(version_of(chunks, versions, visiting, dependency));
    }
    visiting.remove(file_name);
    let version = short_hash(parts.join("|").as_bytes());
    versions.insert(file_name.to_owned(), version.clone());
    version
}

/// Each module's hash propagates through its NON-`.svelte` dependencies and stops at every
/// `.svelte` one: a component swaps itself through its HMR proxy, so a change inside it never
/// bubbles upward.
pub(super) fn compute_final_versions(
    chunks: &BTreeMap<String, HmrChunk>,
) -> BTreeMap<String, String> {
    let mut versions = BTreeMap::new();
    let mut visiting = BTreeSet::new();
    for file_name in chunks.keys() {
        version_of(chunks, &mut versions, &mut visiting, file_name);
    }
    versions
}

/// Dependency chunks (the Svelte runtime, vendor code) are cached singletons every swap resolves
/// against; when the bundler re-splits the graph, the runtime reloads the page instead of swapping.
pub(super) fn hash_vendor_chunks(chunks: &BTreeMap<String, HmrChunk>) -> String {
    let mut entries: Vec<String> = chunks
        .iter()
        .filter(|(_, chunk)| chunk.is_vendor)
        .map(|(file_name, chunk)| format!("{file_name}:{}", chunk.source_hash))
        .collect();
    entries.sort();
    let mut joined = Vec::new();
    for entry in entries {
        joined.extend_from_slice(entry.as_bytes());
        joined.push(VENDOR_ENTRY_TERMINATOR);
    }
    short_hash(&joined)
}

/// `a/b/../c/./d.js` as `a/c/d.js`.
fn normalize_posix(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn directory_of(file_name: &str) -> &str {
    file_name
        .rsplit_once('/')
        .map_or(".", |(directory, _)| directory)
}

/// The version each module was last served under. The page caches a module by its URL, so a reverted
/// edit needs a URL it never saw, or the page hands back the stale instance without running it.
#[derive(Debug, Default)]
pub(super) struct ServedVersions {
    /// Per file name: the content version, and the version its URL carries
    served: BTreeMap<String, (String, String)>,
    changes: u64,
}

impl ServedVersions {
    pub(super) const fn new() -> Self {
        Self {
            served: BTreeMap::new(),
            changes: 0,
        }
    }

    /// The URL version of every module: unchanged content keeps its URL, changed content gets a new one.
    pub(super) fn refresh(
        &mut self,
        versions: BTreeMap<String, String>,
    ) -> BTreeMap<String, String> {
        versions
            .into_iter()
            .map(|(file_name, content)| {
                let url = match self.served.get(&file_name) {
                    Some((served, url)) if *served == content => url.clone(),
                    Some(_) => {
                        self.changes += 1;
                        format!("{content}-{}", self.changes)
                    }
                    None => content.clone(),
                };
                self.served
                    .insert(file_name.clone(), (content, url.clone()));
                (file_name, url)
            })
            .collect()
    }
}

/// Stamps imports with `?v=<version>`.
pub(super) struct ImportStamper {
    pattern: Regex,
}

impl ImportStamper {
    pub(super) fn new() -> Result<Self> {
        Ok(Self {
            pattern: Regex::new(RELATIVE_IMPORT_PATTERN)?,
        })
    }

    /// `?v=<version>` on each non-`.svelte` relative import, so a re-imported boundary refetches
    /// exactly the dependencies whose content changed and reuses the cached rest (the Svelte runtime
    /// singleton).
    pub(super) fn stamp(
        &self,
        file_name: &str,
        chunks: &BTreeMap<String, HmrChunk>,
        versions: &BTreeMap<String, String>,
    ) -> String {
        let Some(chunk) = chunks.get(file_name) else {
            return String::new();
        };
        let from_directory = directory_of(file_name);
        self.pattern
            .replace_all(&chunk.code, |captures: &Captures<'_>| {
                let whole = captures.get(0).map_or("", |found| found.as_str());
                let (Some(prefix), Some(specifier)) = (
                    captures.get(1),
                    captures
                        .get(2)
                        .or_else(|| captures.get(ALTERNATIVE_NAME_GROUP)),
                ) else {
                    return whole.to_owned();
                };
                let target = normalize_posix(&format!("{from_directory}/{}", specifier.as_str()));
                let stampable = chunks.get(&target).is_some_and(|found| !found.is_svelte);
                if !stampable {
                    return whole.to_owned();
                }
                let quote = if captures.get(2).is_some() { '"' } else { '\'' };
                let version = versions.get(&target).map_or("undefined", String::as_str);
                format!(
                    "{}{quote}{}?v={version}{quote}",
                    prefix.as_str(),
                    specifier.as_str()
                )
            })
            .into_owned()
    }
}

#[cfg(test)]
mod tests {
    use crate::dev::hmr::compile::versions::*;

    fn chunk(code: &str, dependencies: &[&str], is_svelte: bool) -> HmrChunk {
        HmrChunk {
            code: code.to_owned(),
            source_hash: short_hash(code.as_bytes()),
            is_svelte,
            is_vendor: false,
            dependencies: dependencies.iter().map(|name| (*name).to_owned()).collect(),
        }
    }

    fn sample() -> BTreeMap<String, HmrChunk> {
        BTreeMap::from([
            (
                "src/a.js".to_owned(),
                chunk(
                    "import { b } from \"./b.js\";\nimport C from './C.svelte.js';",
                    &["src/b.js", "src/C.svelte.js"],
                    false,
                ),
            ),
            (
                "src/b.js".to_owned(),
                chunk("export const b = 1;", &[], false),
            ),
            (
                "src/C.svelte.js".to_owned(),
                chunk("export default 1;", &[], true),
            ),
        ])
    }

    #[test]
    fn a_change_bubbles_through_plain_dependencies_only() {
        let before = compute_final_versions(&sample());
        let mut edited_plain = sample();
        edited_plain.insert(
            "src/b.js".to_owned(),
            chunk("export const b = 2;", &[], false),
        );
        let mut edited_component = sample();
        edited_component.insert(
            "src/C.svelte.js".to_owned(),
            chunk("export default 2;", &[], true),
        );
        let plain = compute_final_versions(&edited_plain);
        let component = compute_final_versions(&edited_component);
        assert_ne!(before.get("src/a.js"), plain.get("src/a.js"));
        assert_eq!(before.get("src/a.js"), component.get("src/a.js"));
    }

    #[test]
    fn only_plain_relative_imports_are_stamped() {
        let chunks = sample();
        let versions = compute_final_versions(&chunks);
        let stamped = ImportStamper::new()
            .unwrap()
            .stamp("src/a.js", &chunks, &versions);
        let version = versions.get("src/b.js").unwrap();
        assert!(stamped.contains(&format!("from \"./b.js?v={version}\"")));
        assert!(stamped.contains("from './C.svelte.js';"));
    }

    #[test]
    fn a_reverted_module_gets_a_url_it_never_had() {
        let mut served = ServedVersions::new();
        let mut url_of = |content: &str| {
            let versions = BTreeMap::from([("a.js".to_owned(), content.to_owned())]);
            served.refresh(versions).remove("a.js").unwrap()
        };
        let first = url_of("one");
        assert_eq!(url_of("one"), first);
        let edited = url_of("two");
        let reverted = url_of("one");
        assert_ne!(reverted, first);
        assert_ne!(reverted, edited);
    }

    #[test]
    fn a_cycle_falls_back_to_the_modules_own_hash() {
        let chunks = BTreeMap::from([
            ("x.js".to_owned(), chunk("x", &["y.js"], false)),
            ("y.js".to_owned(), chunk("y", &["x.js"], false)),
        ]);
        assert_eq!(compute_final_versions(&chunks).len(), 2);
    }

    #[test]
    fn paths_normalize_like_posix() {
        assert_eq!(normalize_posix("a/b/../c/./d.js"), "a/c/d.js");
        assert_eq!(normalize_posix("./x.js"), "x.js");
    }
}
