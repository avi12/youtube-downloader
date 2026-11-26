//! The `output` command group: build output diffing, reload planning, manifest patching and the
//! dev browser's profile. Replaces the pure half of `scripts/dev/{output,browsers,server}`.

mod error;
pub(crate) mod manifest;
pub(crate) mod options;
pub(crate) mod patches;
pub(crate) mod profile;
pub(crate) mod reload;

use std::path::{Path, PathBuf};

use clap::{Subcommand, ValueEnum};
use serde::{de::DeserializeOwned, Serialize};

pub(crate) use self::error::{OutputError, Result as OutputResult};
use self::manifest::{matches_url_pattern, ExtensionManifest};
use self::options::{resolve_options, HostEnvironment, OptionArgs};
use self::reload::{RefreshedPage, ReloadPlan, TabUpdateResult};
use crate::error::Result;

/// The commands of this group.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Print the content hashes and manifest of a build output directory as JSON
    Snapshot {
        /// The build output directory
        dir: PathBuf,
    },
    /// Print the reload plan between two build output directories as JSON
    PlanReload {
        /// The build before the change
        #[arg(long)]
        before: PathBuf,
        /// The build after the change
        #[arg(long)]
        after: PathBuf,
    },
    /// Print the plan that replaces a possibly stale cached background as JSON
    PlanStaleBackground {
        /// The build output directory
        dir: PathBuf,
    },
    /// Word the outcome of a reload plan the way the dev server logs it
    DescribeReload {
        /// The plan, as `plan-reload` prints it
        #[arg(long)]
        plan: PathBuf,
        /// The tab update result of a reload-extension plan
        #[arg(long)]
        tab_result: Option<PathBuf>,
        /// The refreshed pages of a refresh-pages or swap-background plan
        #[arg(long)]
        refreshed_pages: Option<PathBuf>,
    },
    /// Print the content scripts, background files and gecko id of a build as JSON
    Manifest {
        /// The build output directory
        dir: PathBuf,
    },
    /// Test a URL against a manifest match pattern; prints true or false
    MatchUrl {
        /// The URL
        #[arg(long)]
        url: String,
        /// The match pattern
        #[arg(long)]
        pattern: String,
    },
    /// Add the dev recorder content script and the HMR web-accessible resources to manifest.json
    PatchManifest {
        /// The build output directory
        dir: PathBuf,
    },
    /// Patch a finished dev build: background prelude, popup loader, recorder and run-once guards
    PatchOutput {
        /// The build output directory
        dir: PathBuf,
        /// A file holding the background prelude source
        #[arg(long)]
        prelude_file: PathBuf,
        /// The project the build came from, whose sources decide which scripts can be swapped
        #[arg(long, default_value = ".")]
        project_root: PathBuf,
    },
    /// Print one of the JavaScript sources the dev server injects
    JsSource {
        /// Which source
        kind: JsSourceKind,
    },
    /// Print the resolved dev options (flags, `YTDL_DEV` variables and defaults) as JSON
    Options(OptionArgs),
    /// Seed or clean the dev browser's profile
    #[command(subcommand)]
    Profile(ProfileCommand),
}

/// The profile operations.
#[derive(Debug, Subcommand)]
pub(crate) enum ProfileCommand {
    /// Seed the profile from the user's own, once; prints the profile directory
    Clone(OptionArgs),
    /// Stop a leftover browser running on the dev profile
    Clean(OptionArgs),
}

/// The injected sources.
#[derive(Debug, Clone, Copy, ValueEnum)]
pub(crate) enum JsSourceKind {
    /// The page-world recorder of cross-world messages
    Recorder,
    /// The function that replays recorded handshakes
    Replay,
}

fn read_json<T: DeserializeOwned>(path: &Path) -> OutputResult<T> {
    let text = std::fs::read_to_string(path).map_err(OutputError::with_path(path))?;
    Ok(serde_json::from_str(&text)?)
}

fn print_json<T: Serialize>(value: &T) -> OutputResult<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

fn read_optional_json<T: DeserializeOwned + Default>(path: Option<&Path>) -> OutputResult<T> {
    path.map_or_else(|| Ok(T::default()), read_json)
}

fn describe_reload(
    plan: &Path,
    tab_result: Option<&Path>,
    refreshed_pages: Option<&Path>,
) -> OutputResult<()> {
    let plan: ReloadPlan = read_json(plan)?;
    let tab_result: TabUpdateResult = read_optional_json(tab_result)?;
    let refreshed_pages: Vec<RefreshedPage> = read_optional_json(refreshed_pages)?;
    println!(
        "{}",
        reload::describe_reload(&plan, &tab_result, &refreshed_pages)?
    );
    Ok(())
}

fn print_manifest(dir: &Path) -> OutputResult<()> {
    let manifest = ExtensionManifest::read(dir)?;
    print_json(&serde_json::json!({
        "geckoId": manifest.gecko_id(),
        "backgroundFiles": manifest.background_files()?,
        "contentScripts": manifest.list_content_scripts()?,
    }))
}

async fn run_profile(command: ProfileCommand) -> OutputResult<()> {
    let host = HostEnvironment::detect();
    match command {
        ProfileCommand::Clone(args) => {
            let options = resolve_options(&args, &host)?;
            profile::setup_profile(&options, &host)?;
            println!("{}", options.profile_dir.display());
            Ok(())
        }
        ProfileCommand::Clean(args) => {
            let options = resolve_options(&args, &host)?;
            profile::clean_leftover_instances(&options, &host).await
        }
    }
}

async fn execute(command: Command) -> OutputResult<()> {
    match command {
        Command::Snapshot { dir } => print_json(&reload::take_build_snapshot(&dir)?),
        Command::PlanReload { before, after } => {
            let plan = reload::plan_reload(
                &reload::take_build_snapshot(&before)?,
                &reload::take_build_snapshot(&after)?,
            )?;
            print_json(&plan)
        }
        Command::PlanStaleBackground { dir } => print_json(&reload::plan_stale_background_reload(
            &ExtensionManifest::read(&dir)?,
        )?),
        Command::DescribeReload {
            plan,
            tab_result,
            refreshed_pages,
        } => describe_reload(&plan, tab_result.as_deref(), refreshed_pages.as_deref()),
        Command::Manifest { dir } => print_manifest(&dir),
        Command::MatchUrl { url, pattern } => {
            println!("{}", matches_url_pattern(&url, &pattern));
            Ok(())
        }
        Command::PatchManifest { dir } => patches::patch_manifest(&dir),
        Command::PatchOutput {
            dir,
            prelude_file,
            project_root,
        } => {
            let prelude = std::fs::read_to_string(&prelude_file)
                .map_err(OutputError::with_path(&prelude_file))?;
            patches::patch_built_output(&dir, &project_root, &prelude)
        }
        Command::JsSource { kind } => {
            let source = match kind {
                JsSourceKind::Recorder => patches::recorder_source(),
                JsSourceKind::Replay => patches::replay_function_source(),
            };
            print!("{source}");
            Ok(())
        }
        Command::Options(args) => print_json(&resolve_options(&args, &HostEnvironment::detect())?),
        Command::Profile(command) => run_profile(command).await,
    }
}

/// Runs one command of this group.
pub(crate) async fn run(command: Command) -> Result<()> {
    Ok(execute(command).await?)
}
