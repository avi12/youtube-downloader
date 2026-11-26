//! The dev server, in Rust: the launcher, the browser targets, the HMR build and the in-browser payloads.

mod browsers;
mod hmr;
mod launcher;
mod payload;

use clap::Subcommand;

pub(crate) use self::browsers::BrowserError;
pub(crate) use self::hmr::HmrError;
pub(crate) use self::launcher::LauncherError;

use crate::error::Result;

/// The commands of this group.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Runs the dev server (replaces `bun run dev` and `scripts/dev/server/main.ts`)
    Run(launcher::RunArgs),
    /// The HMR build and analysis commands
    #[command(subcommand)]
    Hmr(hmr::Command),
    /// Browser-target commands (reload, background swap)
    #[command(subcommand)]
    Browser(browsers::Command),
    /// The in-browser payloads (HMR runtime, background prelude, loader)
    #[command(subcommand)]
    Payload(payload::Command),
}

/// Runs one command of this group.
pub(crate) async fn run(command: Command) -> Result<()> {
    match command {
        Command::Run(args) => Ok(launcher::run(args).await?),
        Command::Hmr(command) => Ok(hmr::run(command).await?),
        Command::Browser(command) => Ok(browsers::run(command).await?),
        Command::Payload(command) => Ok(payload::run(command).await?),
    }
}
