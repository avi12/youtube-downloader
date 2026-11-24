//! Why editing a chunk cannot be swapped: walks up the importers until a `.svelte` component (the
//! accept boundary) and reports the first module that stops the update.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;

use super::side_effects::find_side_effect;
use crate::dev::hmr::chunks::{ChunkType, OutputChunk};
use crate::dev::hmr::config::{without_query, ProjectPaths};
use crate::dev::hmr::error::Result;

const SVELTE_EXTENSION: &str = ".svelte";

/// What the analysis knows about one code chunk.
#[derive(Debug, Clone)]
pub(super) struct ChunkInfo {
    pub(super) file_name: String,
    pub(super) source_id: Option<String>,
    pub(super) absolute_path: Option<String>,
    pub(super) entry_name: Option<String>,
    pub(super) is_svelte: bool,
}

fn describe_chunk(paths: &ProjectPaths, chunk: &OutputChunk) -> ChunkInfo {
    let absolute_path = chunk
        .facade_module_id
        .as_deref()
        .map(|id| without_query(id).to_owned());
    ChunkInfo {
        file_name: chunk.file_name.clone(),
        source_id: chunk
            .facade_module_id
            .as_deref()
            .and_then(|id| paths.src_id_of(id)),
        entry_name: if chunk.is_entry {
            chunk.name.clone()
        } else {
            None
        },
        is_svelte: absolute_path
            .as_deref()
            .is_some_and(|path| path.ends_with(SVELTE_EXTENSION)),
        absolute_path,
    }
}

fn map_importers(chunks: &[OutputChunk]) -> BTreeMap<String, Vec<String>> {
    let mut importers: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for chunk in chunks {
        for dependency in chunk.dependencies() {
            importers
                .entry(dependency.clone())
                .or_default()
                .push(chunk.file_name.clone());
        }
    }
    importers
}

fn unanalysable(message: &str) -> String {
    let first_line = message.lines().next().unwrap_or_default();
    format!("could not be analysed ({first_line})")
}

fn side_effect_reason(info: &ChunkInfo) -> Result<Option<String>> {
    let Some(path) = &info.absolute_path else {
        return Ok(None);
    };
    let source = match fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) => return Ok(Some(unanalysable(&error.to_string()))),
    };
    let found = match find_side_effect(&source, path)? {
        Ok(found) => found,
        Err(message) => return Ok(Some(unanalysable(&message))),
    };
    Ok(found.map(|effect| format!("{} at line {}", effect.rule, effect.line)))
}

/// Answers "why does editing this chunk reload the page" with a memo of the per-module analysis.
pub(super) struct ReloadReasoner {
    infos: BTreeMap<String, ChunkInfo>,
    importers: BTreeMap<String, Vec<String>>,
    own_reasons: BTreeMap<String, Option<String>>,
}

impl ReloadReasoner {
    pub(super) fn new(paths: &ProjectPaths, chunks: &[OutputChunk]) -> Self {
        let infos = chunks
            .iter()
            .filter(|chunk| chunk.kind == ChunkType::Chunk)
            .map(|chunk| (chunk.file_name.clone(), describe_chunk(paths, chunk)))
            .collect();
        Self {
            infos,
            importers: map_importers(chunks),
            own_reasons: BTreeMap::new(),
        }
    }

    pub(super) fn infos(&self) -> impl Iterator<Item = &ChunkInfo> {
        self.infos.values()
    }

    fn own_reason(&mut self, info: &ChunkInfo) -> Result<Option<String>> {
        if let Some(entry) = &info.entry_name {
            return Ok(Some(format!(
                "it is the {entry} entrypoint, outside any component"
            )));
        }
        if let Some(cached) = self.own_reasons.get(&info.file_name) {
            return Ok(cached.clone());
        }
        let has_importer = self
            .importers
            .get(&info.file_name)
            .is_some_and(|importers| !importers.is_empty());
        let reason = match side_effect_reason(info)? {
            Some(reason) => Some(reason),
            None => (!has_importer).then(|| "no component imports it".to_owned()),
        };
        self.own_reasons
            .insert(info.file_name.clone(), reason.clone());
        Ok(reason)
    }

    pub(super) fn reason_of(&mut self, file_name: &str) -> Result<Option<String>> {
        let mut visited = BTreeSet::new();
        let mut pending = vec![file_name.to_owned()];
        let mut cursor = 0;
        while let Some(current) = pending.get(cursor).cloned() {
            cursor += 1;
            let Some(info) = self.infos.get(&current).cloned() else {
                continue;
            };
            if info.is_svelte || !visited.insert(current.clone()) {
                continue;
            }
            if let Some(reason) = self.own_reason(&info)? {
                return Ok(Some(if current == file_name {
                    reason
                } else {
                    let via = info.source_id.as_deref().unwrap_or(&current);
                    format!("{reason} (via {via})")
                }));
            }
            pending.extend(self.importers.get(&current).cloned().unwrap_or_default());
        }
        Ok(None)
    }
}
