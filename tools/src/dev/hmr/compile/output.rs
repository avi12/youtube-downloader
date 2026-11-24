//! Turns what the bundler wrote into the HMR output: version-stamped modules, the manifest, the
//! loaders and the report of which edits reload the page.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};

use base64::Engine;

use super::versions::{
    compute_final_versions, describe_chunks, hash_vendor_chunks, HmrChunk, ImportStamper,
};
use crate::dev::hmr::analysis::hot_sources::{describe_hot_sources, HotSourceInput};
use crate::dev::hmr::chunks::{BuildOutput, ChunkType, GraphCollector, OutputChunk};
use crate::dev::hmr::config::{
    short_hash, HmrManifest, ManifestModule, ProjectPaths, HMR_MANIFEST_FILE, HMR_OUT_SUBDIR,
    HMR_POPUP_LOADER_FILE, HMR_RUNTIME_FILE, POPUP_ENTRY_NAME,
};
use crate::dev::hmr::error::{HmrError, Result};
use crate::dev::payload::{loader_source, PopupLoaderPaths};

const SVELTE_EXTENSION: &str = ".svelte";

/// The source hash of each module whose edit reloads, as of the previous build of this process.
static PREVIOUS_SOURCE_HASHES: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());

/// A hash of what was last written to each output file, so an edit rewrites only what changed.
static WRITTEN_HASHES: Mutex<BTreeMap<String, String>> = Mutex::new(BTreeMap::new());
/// The set of files the previous build produced, so the stale sweep runs only when it changes.
static PREVIOUS_FILES: Mutex<BTreeSet<String>> = Mutex::new(BTreeSet::new());

/// Everything the post-processing of one build needs.
pub(super) struct FinishInput {
    pub(super) paths: ProjectPaths,
    pub(super) output_directory: PathBuf,
    pub(super) runtime_source: String,
    pub(super) built: BuildOutput,
    pub(super) main_world_modules: BTreeSet<String>,
}

/// What a finished build reports.
pub(super) struct Finished {
    pub(super) manifest: HmrManifest,
    pub(super) reload_logs: Vec<String>,
}

fn chunk_codes(chunks: &[OutputChunk]) -> BTreeMap<String, String> {
    chunks
        .iter()
        .filter(|chunk| chunk.kind == ChunkType::Chunk)
        .map(|chunk| {
            (
                chunk.file_name.clone(),
                chunk.code.clone().unwrap_or_default(),
            )
        })
        .collect()
}

/// Writes `bytes` unless the previous build already wrote the same content there.
fn write_if_changed(output_directory: &Path, file_name: &str, bytes: &[u8]) -> Result<()> {
    let hash = short_hash(bytes);
    let mut written = WRITTEN_HASHES
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if written.get(file_name) == Some(&hash) {
        return Ok(());
    }
    let path = output_directory.join(file_name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(&path, bytes)?;
    written.insert(file_name.to_owned(), hash);
    Ok(())
}

fn write_assets(output_directory: &Path, chunks: &[OutputChunk]) -> Result<()> {
    for chunk in chunks.iter().filter(|chunk| chunk.kind == ChunkType::Asset) {
        let source = chunk.source.as_deref().unwrap_or_default();
        if chunk.is_source_base64 {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(source)
                .map_err(|error| HmrError::Worker(error.to_string()))?;
            write_if_changed(output_directory, &chunk.file_name, &bytes)?;
            continue;
        }
        write_if_changed(output_directory, &chunk.file_name, source.as_bytes())?;
    }
    Ok(())
}

/// A build that emptied the output directory (the WXT build does) invalidates what was written.
fn forget_writes_when_directory_was_emptied(output_directory: &Path) {
    if output_directory.join(HMR_MANIFEST_FILE).exists() {
        return;
    }
    WRITTEN_HASHES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clear();
    PREVIOUS_FILES
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clear();
}

fn describe_modules(
    paths: &ProjectPaths,
    chunks: &[OutputChunk],
    versions: &BTreeMap<String, String>,
    codes: &BTreeMap<String, String>,
    main_world_modules: &BTreeSet<String>,
) -> (BTreeMap<String, ManifestModule>, BTreeMap<String, String>) {
    let mut modules = BTreeMap::new();
    let mut entries = BTreeMap::new();
    for chunk in chunks.iter().filter(|chunk| chunk.kind == ChunkType::Chunk) {
        if let (true, Some(name)) = (chunk.is_entry, &chunk.name) {
            entries.insert(
                name.clone(),
                format!("{HMR_OUT_SUBDIR}/{}", chunk.file_name),
            );
        }
        let Some(facade) = chunk.facade_module_id.as_deref() else {
            continue;
        };
        let Some(source_id) = paths.src_id_of(facade) else {
            continue;
        };
        if !facade.ends_with(SVELTE_EXTENSION) || main_world_modules.contains(&source_id) {
            continue;
        }
        let hash = versions.get(&chunk.file_name).cloned().unwrap_or_else(|| {
            short_hash(
                codes
                    .get(&chunk.file_name)
                    .map_or("", String::as_str)
                    .as_bytes(),
            )
        });
        modules.insert(
            source_id,
            ManifestModule {
                url: format!("{HMR_OUT_SUBDIR}/{}", chunk.file_name),
                hash,
            },
        );
    }
    (modules, entries)
}

fn write_loaders(
    output_directory: &Path,
    entries: &BTreeMap<String, String>,
    runtime_source: &str,
) -> Result<()> {
    write_if_changed(
        output_directory,
        HMR_RUNTIME_FILE,
        runtime_source.as_bytes(),
    )?;
    let Some(popup_entry) = entries.get(POPUP_ENTRY_NAME) else {
        return Ok(());
    };
    let popup_path = popup_entry
        .strip_prefix(&format!("{HMR_OUT_SUBDIR}/"))
        .unwrap_or(popup_entry);
    let loader = loader_source(&PopupLoaderPaths {
        entry: POPUP_ENTRY_NAME.to_owned(),
        runtime_path: format!("./{HMR_RUNTIME_FILE}"),
        popup_path: format!("./{popup_path}"),
    });
    write_if_changed(output_directory, HMR_POPUP_LOADER_FILE, loader.as_bytes())?;
    Ok(())
}

fn collect_files(directory: &Path, found: &mut Vec<PathBuf>) {
    let Ok(listing) = fs::read_dir(directory) else {
        return;
    };
    for entry in listing.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, found);
        } else {
            found.push(path);
        }
    }
}

/// Outputs are written over the previous build (the browser holds served files open, so emptying
/// the directory intermittently fails on Windows); leftovers of renamed sources are swept
/// afterwards, best effort.
fn sweep_stale_outputs(output_directory: &Path, expected_files: &BTreeSet<String>) {
    let mut files = Vec::new();
    collect_files(output_directory, &mut files);
    for file in files {
        let Ok(relative) = file.strip_prefix(output_directory) else {
            continue;
        };
        let spelled = relative.to_string_lossy().replace('\\', "/");
        if expected_files.contains(&spelled) {
            continue;
        }
        let _ = fs::remove_file(&file);
    }
}

/// Which modules whose edit reloads the page changed since the last build, and why - the one place
/// the side-effect rules are reported.
fn describe_reload_logs(
    paths: &ProjectPaths,
    reload_reasons: &BTreeMap<String, String>,
) -> Result<Vec<String>> {
    let mut previous = PREVIOUS_SOURCE_HASHES
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let is_first_build = previous.is_empty();
    let mut logs = Vec::new();
    for (source_id, reason) in reload_reasons {
        let path = PathBuf::from(paths.absolute(source_id));
        let bytes = fs::read(&path).map_err(|source| HmrError::Read { path, source })?;
        let hash = short_hash(&bytes);
        let is_edited_since_last_build = !is_first_build && previous.get(source_id) != Some(&hash);
        if is_edited_since_last_build {
            logs.push(format!("HMR: {source_id} reloads - {reason}"));
        }
        previous.insert(source_id.clone(), hash);
    }
    if is_first_build {
        logs.push(format!(
            "HMR: {} modules reload the page when edited (the rest hot-swap)",
            reload_reasons.len()
        ));
    }
    Ok(logs)
}

fn write_stamped_modules(
    output_directory: &Path,
    by_file_name: &BTreeMap<String, HmrChunk>,
    versions: &BTreeMap<String, String>,
) -> Result<()> {
    let stamper = ImportStamper::new()?;
    for file_name in by_file_name.keys() {
        let rewritten = stamper.stamp(file_name, by_file_name, versions);
        write_if_changed(output_directory, file_name, rewritten.as_bytes())?;
    }
    Ok(())
}

/// Stamps and writes the modules, analyses what can swap, writes the loaders and the manifest.
pub(super) fn finish_build(input: FinishInput) -> Result<Finished> {
    let FinishInput {
        paths,
        output_directory,
        runtime_source,
        built,
        main_world_modules,
    } = input;
    let chunks = &built.chunks;
    fs::create_dir_all(&output_directory)?;
    forget_writes_when_directory_was_emptied(&output_directory);
    write_assets(&output_directory, chunks)?;
    let codes = chunk_codes(chunks);
    let by_file_name = describe_chunks(&paths, chunks, &codes);
    let versions = compute_final_versions(&by_file_name);
    write_stamped_modules(&output_directory, &by_file_name, &versions)?;
    let (modules, entries) =
        describe_modules(&paths, chunks, &versions, &codes, &main_world_modules);
    let graph = GraphCollector::from_modules(&paths, &built.modules);
    let hot_sources = describe_hot_sources(&HotSourceInput {
        paths: &paths,
        chunks,
        graph: &graph,
        main_world_modules: &main_world_modules,
        entries: &entries,
        output_directory: &output_directory,
    })?;
    write_loaders(&output_directory, &entries, &runtime_source)?;
    let expected_files: BTreeSet<String> = chunks
        .iter()
        .map(|chunk| chunk.file_name.clone())
        .chain([
            HMR_MANIFEST_FILE.to_owned(),
            HMR_RUNTIME_FILE.to_owned(),
            HMR_POPUP_LOADER_FILE.to_owned(),
        ])
        .collect();
    let is_file_set_changed = {
        let mut previous = PREVIOUS_FILES
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let is_changed = *previous != expected_files;
        previous.clone_from(&expected_files);
        is_changed
    };
    if is_file_set_changed {
        sweep_stale_outputs(&output_directory, &expected_files);
    }
    let source_modules = modules
        .keys()
        .cloned()
        .chain(hot_sources.swappable_scripts)
        .chain(hot_sources.css_ids)
        .collect();
    let manifest = HmrManifest {
        entries,
        vendor_hash: hash_vendor_chunks(&by_file_name, &versions),
        modules,
        styles: hot_sources.styles,
        reload_reasons: hot_sources.reload_reasons,
        source_modules,
    };
    write_if_changed(
        &output_directory,
        HMR_MANIFEST_FILE,
        serde_json::to_string(&manifest)?.as_bytes(),
    )?;
    let reload_logs = describe_reload_logs(&paths, &manifest.reload_reasons)?;
    Ok(Finished {
        manifest,
        reload_logs,
    })
}
