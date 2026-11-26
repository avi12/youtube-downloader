//! `release linux-vm dev`: the daily runner. Ensures the VM is up, refreshes the host port proxies,
//! syncs the current branch into the VM and runs the dev server there under Xvfb.

use std::path::Path;
use std::time::Duration;

use tokio::net::TcpStream;
use tokio::time::sleep;

use crate::release::linux_vm::multipass::{self, VmDetails};
use crate::release::linux_vm::portproxy::{self, Forward};
use crate::release::linux_vm::{
    render, shell_quote, RootArgs, HOST_CDP_PORT, VM_CHROME_PORT, VM_NAME, VM_SOCAT_PORT,
    VM_WORK_DIR, VNC_PORT,
};
use crate::release::process::Invocation;
use crate::release::ReleaseError;

const MAX_POLL_ATTEMPTS: u32 = 30;
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const FIRST_POLL_DELAY: Duration = Duration::from_secs(15);
const VNC_VIEWER: &str = r"C:\Program Files\RealVNC\VNC Viewer\vncviewer.exe";
const LOOPBACK: &str = "127.0.0.1";
const SOCAT_SCRIPT: &str = include_str!("scripts/socat.sh");
const SYNC_SCRIPT: &str = include_str!("scripts/sync.sh");

async fn running_vm() -> Result<VmDetails, ReleaseError> {
    let Some(details) = multipass::info().await? else {
        return Err(ReleaseError::VmNotFound(VM_NAME.to_owned()));
    };
    if details.is_running() {
        return Ok(details);
    }
    println!("Starting VM '{VM_NAME}'...");
    multipass::start().await?;
    multipass::info()
        .await?
        .ok_or_else(|| ReleaseError::VmNotFound(VM_NAME.to_owned()))
}

async fn refresh_port_proxies(address: &str) -> Result<(), ReleaseError> {
    let table = portproxy::show().await?;
    let stale: Vec<Forward> = [portproxy::CDP, portproxy::VNC]
        .into_iter()
        .filter(|forward| !portproxy::is_forwarded(&table, address, *forward))
        .collect();
    if stale.is_empty() {
        return Ok(());
    }
    println!(
        "Refreshing portproxy (CDP {LOOPBACK}:{HOST_CDP_PORT} -> {address}:{VM_SOCAT_PORT}, VNC {LOOPBACK}:{VNC_PORT} -> {address}:{VNC_PORT})..."
    );
    portproxy::apply(address, &[portproxy::CDP, portproxy::VNC]).await
}

async fn ensure_socat_bridge() -> Result<(), ReleaseError> {
    println!("Ensuring socat bridge {VM_SOCAT_PORT} -> {LOOPBACK}:{VM_CHROME_PORT} inside VM...");
    let script = render(
        SOCAT_SCRIPT,
        &[
            ("BRIDGE_PORT", VM_SOCAT_PORT.to_string()),
            ("CHROME_PORT", VM_CHROME_PORT.to_string()),
        ],
    );
    multipass::run_script(&script).await?;
    Ok(())
}

/// Opens `RealVNC` Viewer once the VM's VNC port answers on the host.
async fn open_viewer_when_ready() {
    sleep(FIRST_POLL_DELAY).await;
    for _ in 0..=MAX_POLL_ATTEMPTS {
        if TcpStream::connect((LOOPBACK, VNC_PORT)).await.is_ok() {
            Invocation::new(VNC_VIEWER)
                .arg(format!("localhost::{VNC_PORT}"))
                .spawn_detached()
                .ok();
            return;
        }
        sleep(POLL_INTERVAL).await;
    }
}

async fn current_branch(root: &Path) -> Result<String, ReleaseError> {
    let branch = Invocation::new("git")
        .arg("-C")
        .arg(root)
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .capture_checked()
        .await?;
    Ok(branch)
}

pub(super) async fn run(args: RootArgs) -> Result<(), ReleaseError> {
    multipass::ensure_installed().await?;
    let details = running_vm().await?;
    let address = details
        .address()
        .ok_or(ReleaseError::NoVmAddress)?
        .to_owned();
    println!("VM IP: {address}");
    refresh_port_proxies(&address).await?;
    ensure_socat_bridge().await?;
    let viewer = tokio::spawn(open_viewer_when_ready());

    let branch = current_branch(&args.root).await?;
    println!("Syncing branch '{branch}' from host -> VM working tree...");
    let script = render(
        SYNC_SCRIPT,
        &[
            ("WORK_DIR", VM_WORK_DIR.to_owned()),
            ("BRANCH", shell_quote(&branch)),
            ("VNC_PORT", VNC_PORT.to_string()),
        ],
    );
    let code = multipass::run_script(&script).await?;
    viewer.abort();
    match code {
        Some(0) | None => Ok(()),
        Some(code) => Err(ReleaseError::VmCommandFailed(code)),
    }
}
