//! `release linux-vm setup`: one-time provisioning of the Ubuntu Multipass VM. Mounts the repository at
//! `/host-repo` so the VM can `git fetch host`, installs the toolchain and exposes the VM's CDP
//! port at `localhost:9234`, matching the `chrome-devtools-mcp-linux` entry of `.mcp.json`.

use std::path::{Path, PathBuf};

use super::multipass;
use super::portproxy;
use super::{render, RootArgs, HOST_CDP_PORT, VM_NAME, VM_SOCAT_PORT};
use crate::release::ReleaseError;

const HOST_MOUNT: &str = "/host-repo";
const PROVISION_SCRIPT: &str = include_str!("scripts/provision.sh");
const WINDOWS_VERBATIM_PREFIX: &str = r"\\?\";

/// A canonical path without the `\\?\` prefix Multipass cannot take.
fn plain_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    text.strip_prefix(WINDOWS_VERBATIM_PREFIX)
        .map_or_else(|| path.to_path_buf(), PathBuf::from)
}

async fn ensure_vm() -> Result<(), ReleaseError> {
    if multipass::info().await?.is_some() {
        println!("VM '{VM_NAME}' already exists.");
        return Ok(());
    }
    multipass::launch().await
}

async fn ensure_mount(project: &Path) -> Result<(), ReleaseError> {
    let details = multipass::info()
        .await?
        .ok_or_else(|| ReleaseError::VmNotFound(VM_NAME.to_owned()))?;
    if details.has_mount(HOST_MOUNT) {
        println!("Mount {HOST_MOUNT} already configured.");
        return Ok(());
    }
    println!(
        "Mounting {} -> {VM_NAME}:{HOST_MOUNT} (classic, host -> guest)...",
        project.display()
    );
    multipass::mount(project, HOST_MOUNT).await
}

async fn provision() -> Result<(), ReleaseError> {
    println!("Provisioning VM toolchain (Node 22, Bun, ffmpeg, Xvfb, Chrome deps)...");
    let script = render(PROVISION_SCRIPT, &[]);
    match multipass::run_script(&script).await? {
        Some(0) => Ok(()),
        code => Err(ReleaseError::VmCommandFailed(code.unwrap_or(-1))),
    }
}

pub(super) async fn run(args: RootArgs) -> Result<(), ReleaseError> {
    let project = plain_path(&tokio::fs::canonicalize(&args.root).await?);
    multipass::ensure_installed().await?;
    ensure_vm().await?;
    ensure_mount(&project).await?;
    provision().await?;

    let details = multipass::info()
        .await?
        .ok_or_else(|| ReleaseError::VmNotFound(VM_NAME.to_owned()))?;
    let address = details.address().ok_or(ReleaseError::NoVmAddress)?;
    println!("VM IP: {address}");
    println!(
        "Configuring netsh portproxy 127.0.0.1:{HOST_CDP_PORT} -> {address}:{VM_SOCAT_PORT}..."
    );
    portproxy::apply(address, &[portproxy::CDP]).await?;

    println!("\nSetup complete.");
    println!("  ytdl release linux-vm dev     - run dev-server inside the VM (Chrome on CDP 9233)");
    println!("  multipass shell {VM_NAME} - open a shell inside the VM");
    println!("  multipass stop {VM_NAME}  - shut down the VM");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_verbatim_prefix_is_removed() {
        assert_eq!(
            plain_path(Path::new(r"\\?\C:\repo")),
            PathBuf::from(r"C:\repo")
        );
        assert_eq!(plain_path(Path::new("/repo")), PathBuf::from("/repo"));
    }
}
