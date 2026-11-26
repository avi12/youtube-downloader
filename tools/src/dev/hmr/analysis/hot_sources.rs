//! Works out, from the HMR build's module graph, which source files an edit can hot-swap:
//!  - `.svelte` files: the component swaps itself through its HMR proxy
//!  - `.ts` / `.svelte.ts` modules: re-imported, which re-mounts the nearest `.svelte` components
//!    importing them (their version changes with it). Allowed only when the module and every module
//!    between it and those components is free of top-level side effects and none of them is an
//!    entrypoint - the way Vite's accept boundaries work: an update that reaches a module nobody
//!    accepts means a reload
//!  - global `.css` files: the entrypoint's runtime swaps the stylesheet in place

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::dev::hmr::analysis::reasons::ReloadReasoner;
use crate::dev::hmr::chunks::{ChunkType, GraphCollector, OutputChunk};
use crate::dev::hmr::config::{
    short_hash, ManifestStyles, ProjectPaths, HMR_ENTRIES, HMR_OUT_SUBDIR,
};
use crate::dev::hmr::error::{HmrError, Result};

const MAIN_WORLD_REASON: &str = "the MAIN-world script also runs it";
const ASSETS_DIR: &str = "assets";

/// What the analysis reads: the bundle, its graph and where its files were written.
pub(crate) struct HotSourceInput<'input> {
    pub(crate) paths: &'input ProjectPaths,
    pub(crate) chunks: &'input [OutputChunk],
    pub(crate) graph: &'input GraphCollector,
    pub(crate) main_world_modules: &'input BTreeSet<String>,
    pub(crate) entries: &'input BTreeMap<String, String>,
    pub(crate) output_directory: &'input Path,
}

/// What an edit can swap, and what it cannot.
pub(crate) struct HotSources {
    pub(crate) swappable_scripts: Vec<String>,
    pub(crate) reload_reasons: BTreeMap<String, String>,
    pub(crate) styles: BTreeMap<String, ManifestStyles>,
    pub(crate) css_ids: Vec<String>,
}

fn is_script_module(path: &str) -> bool {
    Path::new(path)
        .extension()
        .is_some_and(|extension| extension == "ts" || extension == "js")
}

fn reachable_from(chunks: &[OutputChunk], file_name: &str) -> BTreeSet<String> {
    let by_file_name: BTreeMap<&str, &OutputChunk> = chunks
        .iter()
        .map(|chunk| (chunk.file_name.as_str(), chunk))
        .collect();
    let mut reached = BTreeSet::new();
    let mut pending = vec![file_name.to_owned()];
    while let Some(current) = pending.pop() {
        if !reached.insert(current.clone()) {
            continue;
        }
        if let Some(chunk) = by_file_name.get(current.as_str()) {
            pending.extend(chunk.dependencies().cloned());
        }
    }
    reached
}

fn entry_file(entries: &BTreeMap<String, String>, name: &str) -> Option<String> {
    let built = entries.get(name)?;
    built
        .strip_prefix(&format!("{HMR_OUT_SUBDIR}/"))
        .map(str::to_owned)
}

fn own_css_of_entry<'graph>(
    input: &HotSourceInput<'graph>,
    reached: &BTreeSet<String>,
) -> Vec<&'graph String> {
    let chunk_by_source_id: BTreeMap<String, &str> = input
        .chunks
        .iter()
        .filter_map(|chunk| {
            let source_id = input.paths.src_id_of(chunk.facade_module_id.as_deref()?)?;
            Some((source_id, chunk.file_name.as_str()))
        })
        .collect();
    let asset_files: BTreeSet<&str> = input
        .chunks
        .iter()
        .filter(|chunk| chunk.kind == ChunkType::Asset)
        .map(|chunk| chunk.file_name.as_str())
        .collect();
    input
        .graph
        .css_importers
        .iter()
        .filter(|(css_id, _)| {
            !input.graph.queried_css.contains(*css_id)
                && !input.main_world_modules.contains(*css_id)
                && asset_files.contains(format!("{ASSETS_DIR}/{css_id}").as_str())
        })
        .filter(|(_, importer_ids)| {
            importer_ids.iter().any(|importer| {
                chunk_by_source_id
                    .get(importer)
                    .is_some_and(|file| reached.contains(*file))
            })
        })
        .map(|(css_id, _)| css_id)
        .collect()
}

fn describe_styles(
    input: &HotSourceInput<'_>,
) -> Result<(BTreeMap<String, ManifestStyles>, BTreeSet<String>)> {
    let mut styles = BTreeMap::new();
    let mut css_ids = BTreeSet::new();
    for entry in &HMR_ENTRIES {
        let reached = entry_file(input.entries, entry.name)
            .map_or_else(BTreeSet::new, |file| reachable_from(input.chunks, &file));
        let own_css = own_css_of_entry(input, &reached);
        let mut bytes = Vec::new();
        for css_id in &own_css {
            let path = input.output_directory.join(ASSETS_DIR).join(css_id);
            bytes.extend(fs::read(&path).map_err(|source| HmrError::Read { path, source })?);
            css_ids.insert((*css_id).clone());
        }
        let urls = own_css
            .iter()
            .map(|css_id| format!("{HMR_OUT_SUBDIR}/{ASSETS_DIR}/{css_id}"))
            .collect();
        styles.insert(
            entry.name.to_owned(),
            ManifestStyles {
                urls,
                hash: short_hash(&bytes),
            },
        );
    }
    Ok((styles, css_ids))
}

/// Splits the script modules of the bundle into swappable ones and ones whose edit reloads.
pub(crate) fn describe_hot_sources(input: &HotSourceInput<'_>) -> Result<HotSources> {
    let mut reasoner = ReloadReasoner::new(input.paths, input.chunks);
    let infos: Vec<_> = reasoner.infos().cloned().collect();
    let mut swappable_scripts = Vec::new();
    let mut reload_reasons = BTreeMap::new();
    for info in infos {
        let is_script = info.entry_name.is_none()
            && info.absolute_path.as_deref().is_some_and(is_script_module);
        let Some(source_id) = info.source_id.filter(|_| is_script) else {
            continue;
        };
        let reason = if input.main_world_modules.contains(&source_id) {
            Some(MAIN_WORLD_REASON.to_owned())
        } else {
            reasoner.reason_of(&info.file_name)?
        };
        match reason {
            Some(reason) => {
                reload_reasons.insert(source_id, reason);
            }
            None => swappable_scripts.push(source_id),
        }
    }
    let (styles, css_ids) = describe_styles(input)?;
    Ok(HotSources {
        swappable_scripts,
        reload_reasons,
        styles,
        css_ids: css_ids.into_iter().collect(),
    })
}
