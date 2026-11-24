//! The `release` command group: release packaging, download verification, cherry-pick runs and
//! the Linux VM workflow. Replaces `release.ts`, `verify-download.mjs`, `cherry-pick-loop.mjs`,
//! `linux-vm-dev.ts`, `install-hyperv-multipass.ps1`, `setup-linux-vm.ps1` and
//! `linux-vm-provision.sh`.

mod download;
mod linux_vm;
mod package;
pub(crate) mod process;

use std::path::PathBuf;

use clap::Subcommand;
use thiserror::Error;

use crate::cdp::wire::CdpError;
use crate::error::Result;

use self::process::ProcessError;

/// The commands of this group.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Build, pack and sign the release artifacts and write docs/updates.json
    Package(package::Args),
    /// Run one full download cycle in the open `YouTube` watch tab and report the outcome as `JSON`
    VerifyDownload(download::Args),
    /// Cherry-pick a list of commits one at a time, verifying a download after each
    CherryPickLoop(download::cherry_pick::Args),
    /// Manage the Linux Multipass VM used to run the dev server under Xvfb
    #[command(subcommand)]
    LinuxVm(linux_vm::Command),
}

/// Everything that can go wrong in the release group.
#[derive(Debug, Error)]
pub(crate) enum ReleaseError {
    /// A spawned program failed to start or exited unsuccessfully.
    #[error(transparent)]
    Process(#[from] ProcessError),
    /// A CDP session failed.
    #[error(transparent)]
    Cdp(#[from] CdpError),
    /// The shared CDP library failed.
    #[error(transparent)]
    Library(#[from] ytdl_dev_hot::Error),
    /// Reading or writing a file failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// A JSON document did not parse or serialize.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// A required environment variable is unset or empty.
    #[error("{name} is required to produce all release artifacts")]
    MissingEnvironment {
        /// The variable name.
        name: &'static str,
    },
    /// The Chrome signing key does not exist.
    #[error("CHROME_CRX_PRIVATE_KEY_PATH={} not found", .0.display())]
    KeyNotFound(PathBuf),
    /// No Chrome binary was found to pack the CRX.
    #[error("Could not locate a Chrome binary to pack the .crx; install Chrome for Testing or set CHROME_BIN")]
    ChromeNotFound,
    /// A browser build directory is missing.
    #[error("{browser} build not found at {}", path.display())]
    BuildMissing {
        /// Which browser's build.
        browser: &'static str,
        /// Where it was expected.
        path: PathBuf,
    },
    /// An expected artifact was not produced.
    #[error("{description} was not created at {}", path.display())]
    ArtifactMissing {
        /// What the artifact is.
        description: &'static str,
        /// Where it was expected.
        path: PathBuf,
    },
    /// The signing step left no XPI for the version.
    #[error("Could not find the signed Firefox XPI for version {0}")]
    NoSignedXpi(String),
    /// The download verification ended without a completed download.
    #[error("{0}")]
    VerificationFailed(String),
    /// The commits file is missing.
    #[error("commits file missing: {}", .0.display())]
    CommitsFileMissing(PathBuf),
    /// The cherry-pick loop stopped for triage.
    #[error("{0}")]
    CherryPickHalted(String),
    /// Multipass is not installed.
    #[error("multipass not on PATH. Run `ytdl release linux-vm install-prerequisites` first.")]
    MultipassMissing,
    /// The VM does not exist yet.
    #[error("VM '{0}' not found. Run: ytdl release linux-vm setup")]
    VmNotFound(String),
    /// The VM has no IPv4 address.
    #[error("Could not determine VM IP")]
    NoVmAddress,
    /// A command inside the VM exited unsuccessfully.
    #[error("command in the VM exited with code {0}")]
    VmCommandFailed(i32),
}

impl ReleaseError {
    /// Whether the command could not run (missing input, a broken session) rather than a check
    /// failing.
    pub(crate) const fn is_script_error(&self) -> bool {
        matches!(
            self,
            Self::CommitsFileMissing(_)
                | Self::Cdp(_)
                | Self::Library(_)
                | Self::Io(_)
                | Self::Json(_)
        )
    }
}

/// Runs one command of this group.
pub(crate) async fn run(command: Command) -> Result<()> {
    Ok(dispatch(command).await?)
}

async fn dispatch(command: Command) -> std::result::Result<(), ReleaseError> {
    match command {
        Command::Package(args) => package::run(args).await,
        Command::VerifyDownload(args) => download::run(args).await,
        Command::CherryPickLoop(args) => download::cherry_pick::run(args).await,
        Command::LinuxVm(command) => linux_vm::run(command).await,
    }
}
