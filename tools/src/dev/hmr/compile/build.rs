//! Orchestrates one HMR build: the two worker builds, then the Rust post-processing.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use tokio::fs;

use super::output::{finish_build, FinishInput};
use super::protocol::{WorkerJob, MODE_DEVELOPMENT};
use super::update::ContentScriptUpdate;
use super::worker::{run_worker, Transforms, WorkerRole};
use crate::dev::hmr::analysis::wxt_resolution::{
    entry_inputs, read_auto_imports, read_path_aliases, virtual_modules, PathAlias, VirtualModules,
};
use crate::dev::hmr::chunks::GraphCollector;
use crate::dev::hmr::config::{BuildBrowser, ProjectPaths, HMR_OUT_SUBDIR, HMR_RUNTIME_GLOBAL};
use crate::dev::hmr::error::Result;
use ytdl_dev_hot::types::RelPath;

const MAIN_WORLD_ENTRY: &str = "src/layers/youtube/entrypoints/youtube-main.content/index.ts";
const MAIN_WORLD_NAME: &str = "main";
const MAIN_WORLD_CACHE: [&str; 3] = ["node_modules", ".cache", "ytdl-hmr-main-world"];

/// What one HMR build needs to know.
#[derive(Debug, Clone)]
pub(crate) struct HmrRequest {
    /// The project (the repository root).
    pub(crate) project_root: PathBuf,
    /// The extension build output the HMR modules are added under.
    pub(crate) output_dir: PathBuf,
    /// The browser the build targets.
    pub(crate) browser: BuildBrowser,
    /// The in-page runtime, written as `runtime.js`.
    pub(crate) runtime_source: String,
}

/// What one HMR build reports.
#[derive(Debug, Clone)]
pub(crate) struct HmrBuild {
    /// Every source file an edit can hot-swap.
    pub(crate) source_modules: Vec<RelPath>,
    /// Lines worth logging about modules that can't hot-swap and what the running pages do.
    pub(crate) logs: Vec<String>,
    /// What the running pages do with this build, against the previous one.
    pub(crate) content_script_update: ContentScriptUpdate,
}

/// What the two worker builds share.
struct SharedJobParts {
    paths: ProjectPaths,
    aliases: Vec<PathAlias>,
    virtual_modules: VirtualModules,
    cache_epoch: u64,
}

fn forward_slashes(path: &std::path::Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

impl SharedJobParts {
    fn job<'job>(
        &'job self,
        browser: BuildBrowser,
        output_directory: &'job str,
        input: &'job BTreeMap<String, String>,
    ) -> WorkerJob<'job> {
        WorkerJob {
            project_root: self.paths.root(),
            src_prefix: self.paths.src_prefix(),
            runtime_global: HMR_RUNTIME_GLOBAL,
            mode: MODE_DEVELOPMENT,
            browser,
            output_directory,
            input,
            cache_epoch: self.cache_epoch,
            aliases: &self.aliases,
            virtual_modules: &self.virtual_modules,
        }
    }
}

/// Builds the HMR modules and the manifest the in-page runtime polls under `<output>/hmr/`.
pub(crate) async fn build_hmr(request: &HmrRequest) -> Result<HmrBuild> {
    let paths = ProjectPaths::new(&request.project_root);
    let output_directory = request.output_dir.join(HMR_OUT_SUBDIR);
    fs::create_dir_all(&output_directory).await?;
    let transforms = Transforms::new(read_auto_imports(&paths)?)?;
    let shared = SharedJobParts {
        aliases: read_path_aliases(&paths)?,
        virtual_modules: virtual_modules(&paths),
        cache_epoch: transforms.cache_epoch(),
        paths,
    };
    let output_spelled = forward_slashes(&output_directory);
    let entry_input = entry_inputs(&shared.paths);
    let main_world_input = BTreeMap::from([(
        MAIN_WORLD_NAME.to_owned(),
        shared.paths.absolute(MAIN_WORLD_ENTRY),
    )]);
    let main_world_cache = MAIN_WORLD_CACHE
        .iter()
        .fold(request.project_root.clone(), |path, part| path.join(part));
    let main_world_spelled = forward_slashes(&main_world_cache);
    let build_job = shared.job(request.browser, &output_spelled, &entry_input);
    let main_world_job = shared.job(request.browser, &main_world_spelled, &main_world_input);
    let (built, main_world) = tokio::try_join!(
        run_worker(
            WorkerRole::Entries,
            &request.project_root,
            &build_job,
            &transforms
        ),
        run_worker(
            WorkerRole::MainWorld,
            &request.project_root,
            &main_world_job,
            &transforms
        )
    )?;
    let main_world_modules: BTreeSet<String> =
        GraphCollector::from_modules(&shared.paths, &main_world.modules).files;
    let finish = FinishInput {
        browser: request.browser,
        paths: shared.paths,
        output_directory,
        runtime_source: request.runtime_source.clone(),
        built,
        main_world_modules,
    };
    let finished = tokio::task::spawn_blocking(move || finish_build(finish)).await??;
    Ok(HmrBuild {
        source_modules: finished
            .manifest
            .source_modules
            .iter()
            .map(RelPath::new)
            .collect(),
        logs: finished.logs,
        content_script_update: finished.content_script_update,
    })
}
