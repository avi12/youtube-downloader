//! `release linux-vm`: the Linux Multipass VM that runs the dev server under Xvfb. Replaces
//! `linux-vm-dev.ts`, `setup-linux-vm.ps1` and `install-hyperv-multipass.ps1`; the scripts that
//! run inside the VM live in `vm/scripts` and are embedded.

mod dev;
mod multipass;
mod portproxy;
mod prerequisites;
mod setup;

use std::path::PathBuf;

use clap::{Args as ClapArgs, Subcommand};

use crate::release::ReleaseError;

const VM_NAME: &str = "ytdl-linux";
/// Where the VM's CDP port is reachable on the host.
const HOST_CDP_PORT: u16 = 9234;
/// The port Chrome binds inside the VM.
const VM_CHROME_PORT: u16 = 9233;
/// The VM-side socat bridge that makes Chrome's loopback-only port reachable from the host.
const VM_SOCAT_PORT: u16 = 9235;
const VNC_PORT: u16 = 5900;
const VM_WORK_DIR: &str = "/home/ubuntu/youtube-downloader";

/// The commands of `release linux-vm`.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Start the VM, refresh the port proxy, sync the branch and run the dev server inside it
    Dev(RootArgs),
    /// One-time setup: create the VM, mount the repository, provision the toolchain, set the port proxy
    Setup(RootArgs),
    /// Enable Hyper-V and install Multipass (elevated; a reboot follows Hyper-V enablement)
    InstallPrerequisites,
}

/// The repository the VM works on.
#[derive(Debug, Clone, ClapArgs)]
pub(crate) struct RootArgs {
    /// The repository root
    #[arg(long, default_value = ".")]
    root: PathBuf,
}

pub(super) async fn run(command: Command) -> Result<(), ReleaseError> {
    match command {
        Command::Dev(args) => dev::run(args).await,
        Command::Setup(args) => setup::run(args).await,
        Command::InstallPrerequisites => prerequisites::run().await,
    }
}

/// Fills `{{KEY}}` placeholders of an embedded script.
fn render(template: &str, values: &[(&str, String)]) -> String {
    values
        .iter()
        .fold(template.replace("\r\n", "\n"), |script, (key, value)| {
            script.replace(&format!("{{{{{key}}}}}"), value)
        })
}

/// Wraps `raw` in single quotes for a POSIX shell running inside the VM.
fn shell_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use crate::release::linux_vm::*;

    #[test]
    fn placeholders_are_filled_and_crlf_is_normalised() {
        let script = render("cd {{DIR}}\r\necho {{DIR}}", &[("DIR", "/x".to_owned())]);
        assert_eq!(script, "cd /x\necho /x");
    }

    #[test]
    fn quotes_inside_a_branch_name_are_escaped() {
        assert_eq!(shell_quote("feat/it's"), r"'feat/it'\''s'");
    }
}
