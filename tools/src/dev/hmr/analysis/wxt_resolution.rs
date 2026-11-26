//! What only the WXT build knows - its path aliases, auto-imports and `#imports` barrel - for the
//! standalone HMR build. The worker does the Vite hooks; the data and the source rewrite live here.

use std::collections::BTreeMap;
use std::fmt;
use std::fs;
use std::path::Path;

use regex::Regex;
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};

use crate::dev::hmr::config::{EntryKind, ProjectPaths, HMR_ENTRIES};
use crate::dev::hmr::error::{HmrError, Result};

const WXT_DIR: &str = ".wxt";
const VIRTUAL_PREFIX: &str = "\0ytdl:";
const WXT_IMPORTS_SPECIFIER: &str = "#imports";
const VIRTUAL_SPECIFIER_PREFIX: &str = "virtual:";
const AUTO_IMPORT_LINE: &str = r"const (\w+): typeof import\('([^']+)'\)\.(\w+)";
const CONTENT_SCRIPT_CONTEXT_MODULE: &str = "wxt/utils/content-script-context";

/// `#imports` is WXT's auto-import barrel, unresolvable outside the WXT build: its value
/// re-exports (mirrors `.wxt/types/imports-module.d.ts`, types dropped).
const WXT_IMPORTS_BARREL: [&str; 15] = [
    r#"export { browser } from "wxt/browser";"#,
    r#"export { storage } from "wxt/utils/storage";"#,
    r#"export { getAppConfig, useAppConfig } from "wxt/utils/app-config";"#,
    r#"export { ContentScriptContext } from "wxt/utils/content-script-context";"#,
    r#"export { createIframeUi } from "wxt/utils/content-script-ui/iframe";"#,
    r#"export { createIntegratedUi } from "wxt/utils/content-script-ui/integrated";"#,
    r#"export { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";"#,
    r#"export { defineAppConfig } from "wxt/utils/define-app-config";"#,
    r#"export { defineBackground } from "wxt/utils/define-background";"#,
    r#"export { defineContentScript } from "wxt/utils/define-content-script";"#,
    r#"export { defineUnlistedScript } from "wxt/utils/define-unlisted-script";"#,
    r#"export { defineWxtPlugin } from "wxt/utils/define-wxt-plugin";"#,
    r#"export { injectScript } from "wxt/utils/inject-script";"#,
    r#"export { InvalidMatchPattern, MatchPattern } from "wxt/utils/match-patterns";"#,
    r#"export { afterUpdate, beforeUpdate, createEventDispatcher, getAllContexts, getContext, hasContext, onDestroy, onMount, setContext, tick } from "svelte";"#,
];

/// One path alias of `.wxt/tsconfig.json`, resolved to an absolute target.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PathAlias {
    pub(crate) prefix: String,
    pub(crate) is_wildcard: bool,
    pub(crate) target_base: String,
}

/// The ids the worker's resolution plugin matches and the modules it serves.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VirtualModules {
    pub(crate) content_entry_prefix: String,
    pub(crate) imports_specifier: &'static str,
    pub(crate) imports_id: String,
    pub(crate) stub_specifier_prefix: &'static str,
    pub(crate) stub_id_prefix: String,
    pub(crate) modules: BTreeMap<String, String>,
}

/// One name WXT auto-imports.
#[derive(Debug, Clone)]
pub(crate) struct AutoImport {
    name: String,
    source: String,
    exported: String,
}

/// The id of the virtual module wrapping a content script entry.
pub(crate) fn content_entry_id(source_path: &str) -> String {
    format!("{VIRTUAL_PREFIX}content-entry:{source_path}")
}

/// The input of one entry: a page is built from its file, a content script from its wrapper.
pub(crate) fn entry_inputs(paths: &ProjectPaths) -> BTreeMap<String, String> {
    HMR_ENTRIES
        .iter()
        .map(|entry| {
            let absolute = paths.absolute(entry.source_path);
            let input = match entry.kind {
                EntryKind::Page => absolute,
                EntryKind::ContentScript => content_entry_id(&absolute),
            };
            (entry.name.to_owned(), input)
        })
        .collect()
}

/// The virtual modules the standalone build serves: the barrel and one wrapper per content script.
pub(crate) fn virtual_modules(paths: &ProjectPaths) -> VirtualModules {
    let imports_id = format!("{VIRTUAL_PREFIX}wxt-imports");
    let mut modules = BTreeMap::from([(imports_id.clone(), WXT_IMPORTS_BARREL.join("\n"))]);
    for entry in HMR_ENTRIES
        .iter()
        .filter(|entry| entry.kind == EntryKind::ContentScript)
    {
        let source_path = paths.absolute(entry.source_path);
        let wrapper = [
            format!("import definition from {};", json_string(&source_path)),
            format!("import {{ ContentScriptContext }} from \"{CONTENT_SCRIPT_CONTEXT_MODULE}\";"),
            // The runtime invalidates the previous context before running this again
            "export function run() {".to_owned(),
            "  globalThis.ytdlDevRunDisposers = [];".to_owned(),
            format!(
                "  globalThis.ytdlDevContentContext = new ContentScriptContext({}, definition);",
                json_string(entry.name)
            ),
            "  return definition.main(globalThis.ytdlDevContentContext);".to_owned(),
            "}".to_owned(),
        ];
        modules.insert(content_entry_id(&source_path), wrapper.join("\n"));
    }
    VirtualModules {
        content_entry_prefix: content_entry_id(""),
        imports_specifier: WXT_IMPORTS_SPECIFIER,
        imports_id,
        stub_specifier_prefix: VIRTUAL_SPECIFIER_PREFIX,
        stub_id_prefix: format!("{VIRTUAL_PREFIX}stub:"),
        modules,
    }
}

fn json_string(text: &str) -> String {
    serde_json::Value::String(text.to_owned()).to_string()
}

struct OrderedPaths(Vec<(String, Vec<String>)>);

impl<'de> Deserialize<'de> for OrderedPaths {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> std::result::Result<Self, D::Error> {
        struct PathsVisitor;

        impl<'de> Visitor<'de> for PathsVisitor {
            type Value = OrderedPaths;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a map of path patterns to target lists")
            }

            fn visit_map<A: MapAccess<'de>>(
                self,
                mut map: A,
            ) -> std::result::Result<Self::Value, A::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = map.next_entry::<String, Vec<String>>()? {
                    entries.push(entry);
                }
                Ok(OrderedPaths(entries))
            }
        }

        deserializer.deserialize_map(PathsVisitor)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompilerOptions {
    paths: OrderedPaths,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Tsconfig {
    compiler_options: CompilerOptions,
}

/// `a/b/../c` as `a/c`, with `/` separators and the root (`C:` or empty) kept as the first segment.
fn resolve_posix(base: &str, relative: &str) -> String {
    let joined = format!("{}/{relative}", base.replace('\\', "/"));
    let mut parts: Vec<&str> = Vec::new();
    for part in joined.split('/') {
        match part {
            "." => {}
            ".." => {
                let has_nested_segments = parts.len() > 1;
                if has_nested_segments {
                    parts.pop();
                }
            }
            "" if !parts.is_empty() => {}
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn aliases_of(wxt_directory: &str, tsconfig: Tsconfig) -> Vec<PathAlias> {
    tsconfig
        .compiler_options
        .paths
        .0
        .into_iter()
        .filter_map(|(pattern, targets)| {
            let target = targets.into_iter().next()?;
            Some(PathAlias {
                prefix: pattern.trim_end_matches('*').to_owned(),
                is_wildcard: pattern.ends_with('*'),
                target_base: resolve_posix(wxt_directory, target.trim_end_matches('*')),
            })
        })
        .collect()
}

/// The path aliases WXT generated, in declaration order.
pub(crate) fn read_path_aliases(paths: &ProjectPaths) -> Result<Vec<PathAlias>> {
    let wxt_directory = paths.absolute(WXT_DIR);
    let path = Path::new(&wxt_directory).join("tsconfig.json");
    let text = fs::read_to_string(&path).map_err(|source| HmrError::Read {
        path: path.clone(),
        source,
    })?;
    Ok(aliases_of(&wxt_directory, serde_json::from_str(&text)?))
}

/// The names WXT auto-imports, from its generated declarations.
pub(crate) fn read_auto_imports(paths: &ProjectPaths) -> Result<Vec<AutoImport>> {
    let path = Path::new(&paths.absolute(WXT_DIR)).join("types/imports.d.ts");
    let declarations = fs::read_to_string(&path).map_err(|source| HmrError::Read {
        path: path.clone(),
        source,
    })?;
    Ok(Regex::new(AUTO_IMPORT_LINE)?
        .captures_iter(&declarations)
        .filter_map(|captures| {
            Some(AutoImport {
                name: captures.get(1)?.as_str().to_owned(),
                source: captures.get(2)?.as_str().to_owned(),
                exported: captures.get(3)?.as_str().to_owned(),
            })
        })
        .collect())
}

fn is_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

/// Whether `name` appears as a free identifier: not after a word character, `$` or `.`, and not
/// followed by a word character.
fn is_used(code: &str, name: &str) -> bool {
    code.match_indices(name).any(|(start, _)| {
        let before = code.get(..start).and_then(|head| head.bytes().next_back());
        let after = code
            .get(start + name.len()..)
            .and_then(|tail| tail.bytes().next());
        let is_boundary_before =
            before.is_none_or(|byte| !is_word_byte(byte) && byte != b'$' && byte != b'.');
        let is_boundary_after = after.is_none_or(|byte| !is_word_byte(byte));
        is_boundary_before && is_boundary_after
    })
}

/// Whether the module declares the name as a binding or imports it by name - not merely uses it on
/// the right of `const x = storage...`.
fn is_declared(code: &str, name: &str) -> Result<bool> {
    let escaped = regex::escape(name);
    let pattern = format!(
        r"(?-u:\b)(?:const|let|var|function|class)\s+{escaped}(?-u:\b)|(?-u:\b)import(?-u:\b)[^;]*?(?-u:\b){escaped}(?-u:\b)[^;]*?(?-u:\b)from(?-u:\b)"
    );
    Ok(Regex::new(&pattern)?.is_match(code))
}

/// The code with an `import` line for every auto-imported name it uses without declaring.
pub(crate) fn source_with_auto_imports(code: &str, auto_imports: &[AutoImport]) -> Result<String> {
    let mut imports = Vec::new();
    for auto_import in auto_imports {
        let is_missing_import =
            is_used(code, &auto_import.name) && !is_declared(code, &auto_import.name)?;
        if is_missing_import {
            imports.push(format!(
                "import {{ {} as {} }} from \"{}\";",
                auto_import.exported, auto_import.name, auto_import.source
            ));
        }
    }
    if imports.is_empty() {
        return Ok(code.to_owned());
    }
    Ok(format!("{}\n{code}", imports.join("\n")))
}

#[cfg(test)]
mod tests;
