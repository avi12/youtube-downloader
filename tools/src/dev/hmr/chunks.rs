//! What the compile worker reports about a bundle, and the module graph derived from it.

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;

use super::config::ProjectPaths;

const CSS_EXTENSION: &str = ".css";

/// Whether a bundler output is a code chunk or an emitted asset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ChunkType {
    /// A JavaScript module.
    Chunk,
    /// Anything else the bundler emitted, such as a stylesheet.
    Asset,
}

/// One bundler output.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub(crate) struct OutputChunk {
    #[serde(rename = "type")]
    pub(crate) kind: ChunkType,
    #[serde(default)]
    pub(crate) name: Option<String>,
    pub(crate) file_name: String,
    #[serde(default)]
    pub(crate) is_entry: bool,
    #[serde(default)]
    pub(crate) facade_module_id: Option<String>,
    #[serde(default)]
    pub(crate) module_ids: Vec<String>,
    #[serde(default)]
    pub(crate) imports: Vec<String>,
    #[serde(default)]
    pub(crate) dynamic_imports: Vec<String>,
    /// The module's code, for a chunk.
    #[serde(default)]
    pub(crate) code: Option<String>,
    /// The file's content, for an asset.
    #[serde(default)]
    pub(crate) source: Option<String>,
    #[serde(default)]
    pub(crate) is_source_base64: bool,
}

impl OutputChunk {
    /// The files this chunk imports, statically or dynamically.
    pub(crate) fn dependencies(&self) -> impl Iterator<Item = &String> {
        self.imports.iter().chain(&self.dynamic_imports)
    }
}

/// One module the bundler loaded, and the modules importing it.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ModuleRecord {
    pub(crate) id: String,
    pub(crate) importers: Vec<String>,
}

/// What the compile worker returns.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct BuildOutput {
    #[serde(default)]
    pub(crate) chunks: Vec<OutputChunk>,
    #[serde(default)]
    pub(crate) modules: Vec<ModuleRecord>,
}

/// The source files of a build and how its stylesheets are imported.
#[derive(Debug, Default)]
pub(crate) struct GraphCollector {
    pub(crate) files: BTreeSet<String>,
    /// Css source id to the source ids of the modules importing it.
    pub(crate) css_importers: BTreeMap<String, Vec<String>>,
    /// Css imported with a query (`?inline`): its text is consumed as a string, not applied globally.
    pub(crate) queried_css: BTreeSet<String>,
}

impl GraphCollector {
    pub(crate) fn from_modules(paths: &ProjectPaths, modules: &[ModuleRecord]) -> Self {
        let mut graph = Self::default();
        for module in modules {
            let Some(source_id) = paths.src_id_of(&module.id) else {
                continue;
            };
            graph.files.insert(source_id.clone());
            if !source_id.ends_with(CSS_EXTENSION) {
                continue;
            }
            if module.id.contains('?') {
                graph.queried_css.insert(source_id.clone());
            }
            let importers = module
                .importers
                .iter()
                .filter_map(|importer| paths.src_id_of(importer))
                .collect();
            graph.css_importers.insert(source_id, importers);
        }
        graph
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    #[test]
    fn css_importers_keep_only_source_modules() {
        let paths = ProjectPaths::new(Path::new("/repo"));
        let modules = [
            ModuleRecord {
                id: "/repo/src/a.css".to_owned(),
                importers: vec![
                    "/repo/src/b.ts".to_owned(),
                    "/repo/node_modules/c.js".to_owned(),
                ],
            },
            ModuleRecord {
                id: "/repo/src/d.css?inline".to_owned(),
                importers: Vec::new(),
            },
        ];
        let graph = GraphCollector::from_modules(&paths, &modules);
        assert_eq!(
            graph.css_importers.get("src/a.css"),
            Some(&vec!["src/b.ts".to_owned()])
        );
        assert!(graph.queried_css.contains("src/d.css"));
    }
}
