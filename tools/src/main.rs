//! `ytdl`: developer and release tooling of the `YouTube` Downloader extension.
//!
//! Command families (`ytdl <family> --help` lists each one):
//! - `cdp`: Chrome `DevTools` Protocol probes, inspections, checks, log dumps and screenshots
//! - `firefox`: Firefox RDP and Marionette helpers
//! - `release`: release packaging, download verification, cherry-pick runs and the Linux VM
//! - `output`: build output diffing, reload planning, manifest patching and the dev profile
//!
//! Exit codes: 0 on success, 1 when a command ran and failed, 2 when it could not run (missing
//! input or a broken script).

mod cdp;
mod dev;
mod error;
mod firefox;
mod output;
mod port;
mod release;

use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "ytdl", version, about)]
struct Cli {
    #[command(subcommand)]
    group: Group,
}

#[derive(Debug, Subcommand)]
enum Group {
    /// Chrome `DevTools` Protocol probes, inspections and checks
    #[command(subcommand)]
    Cdp(cdp::Command),
    /// Firefox RDP and Marionette helpers
    #[command(subcommand)]
    Firefox(firefox::Command),
    /// Releases, download verification and VM provisioning
    #[command(subcommand)]
    Release(release::Command),
    /// The dev server: launcher, browser targets, HMR build and in-browser payloads
    #[command(subcommand)]
    Dev(dev::Command),
    /// Build output diffing, reload planning and manifest patching
    #[command(subcommand)]
    Output(output::Command),
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let cli = Cli::parse();
    let outcome = match cli.group {
        Group::Cdp(command) => cdp::run(command).await,
        Group::Firefox(command) => firefox::run(command).await,
        Group::Release(command) => release::run(command).await,
        Group::Dev(command) => dev::run(command).await,
        Group::Output(command) => output::run(command).await,
    };
    match outcome {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{error}");
            error.exit_code()
        }
    }
}
