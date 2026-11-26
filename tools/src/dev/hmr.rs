//! The HMR build of the dev server: compiles the Svelte component trees into re-importable modules
//! and works out which edits can hot-swap and which reload the page.

mod analysis;
mod chunks;
mod compile;
mod config;
mod error;

use std::path::PathBuf;

use clap::Subcommand;

use self::analysis::side_effects::find_side_effect;
pub(crate) use self::compile::{build_hmr, ContentScriptUpdate, HmrBuild, HmrRequest};
use self::config::BuildBrowser;
pub(crate) use self::error::HmrError;

/// The commands of this part.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Builds the HMR modules and manifest under `<output-dir>/hmr` and lists what can swap
    Build {
        /// The project (the repository root)
        #[arg(long, default_value = ".")]
        project_root: PathBuf,
        /// The extension build output the HMR modules are added under
        #[arg(long)]
        output_directory: PathBuf,
        /// The browser the build targets
        #[arg(long, value_enum, default_value_t = BuildBrowser::Chrome)]
        browser: BuildBrowser,
        /// The in-page runtime, written as `runtime.js`
        #[arg(long)]
        runtime_file: PathBuf,
    },
    /// Reports the first top-level side effect of a module, which makes an edit to it reload
    SideEffects {
        /// The TypeScript or JavaScript module
        file: PathBuf,
    },
}

/// Runs one command of this part.
pub(crate) async fn run(command: Command) -> Result<(), HmrError> {
    match command {
        Command::Build {
            project_root,
            output_directory,
            browser,
            runtime_file,
        } => {
            let runtime_source = tokio::fs::read_to_string(&runtime_file).await?;
            let request = HmrRequest {
                project_root,
                output_directory,
                browser,
                runtime_source,
            };
            let built: HmrBuild = build_hmr(&request).await?;
            for line in &built.logs {
                println!("{line}");
            }
            for module in &built.source_modules {
                println!("{}", module.as_str());
            }
            Ok(())
        }
        Command::SideEffects { file } => {
            let source = tokio::fs::read_to_string(&file).await?;
            match find_side_effect(&source, &file.to_string_lossy())?.map_err(HmrError::Parse)? {
                Some(found) => println!("{} at line {}", found.rule, found.line),
                None => println!("safe to re-import"),
            }
            Ok(())
        }
    }
}
