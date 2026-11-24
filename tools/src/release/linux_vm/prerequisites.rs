//! `release linux-vm install-prerequisites`: enables Hyper-V and installs Multipass system-wide. Needs
//! an elevated shell, so a non-elevated run relaunches itself elevated. A reboot is needed after
//! Hyper-V enablement; this never reboots on its own.

use tokio::io::{AsyncBufReadExt, BufReader};

use crate::release::process::Invocation;
use crate::release::ReleaseError;

const ENABLE_HYPER_V: &str = "(Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All -NoRestart).RestartNeeded";
const WINGET_PACKAGE: &str = "Canonical.Multipass";
/// `APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE`: the package is already installed.
const WINGET_ALREADY_INSTALLED: i32 = -1_978_335_189;

/// `net session` only succeeds in an elevated shell.
async fn is_elevated() -> bool {
    Invocation::new("net")
        .arg("session")
        .capture()
        .await
        .is_ok_and(|output| output.code == Some(0))
}

async fn relaunch_elevated() -> Result<(), ReleaseError> {
    println!("Re-launching elevated...");
    let executable = std::env::current_exe()?
        .display()
        .to_string()
        .replace('\'', "''");
    let command = format!(
        "Start-Process -FilePath '{executable}' -ArgumentList 'release','linux-vm','install-prerequisites' -Verb RunAs"
    );
    Invocation::new("powershell")
        .args(["-NoProfile", "-Command", &command])
        .run_inherited()
        .await?;
    Ok(())
}

async fn needs_restart() -> Result<bool, ReleaseError> {
    println!("=== Enabling Microsoft-Hyper-V (online, no auto-restart) ===");
    let output = Invocation::new("powershell")
        .args(["-NoProfile", "-Command", ENABLE_HYPER_V])
        .capture_checked()
        .await?;
    Ok(output.eq_ignore_ascii_case("true"))
}

async fn install_multipass() -> Result<(), ReleaseError> {
    println!("\n=== Installing {WINGET_PACKAGE} (system scope) ===");
    let code = Invocation::new("winget")
        .args([
            "install",
            "--id",
            WINGET_PACKAGE,
            "--scope",
            "machine",
            "--silent",
        ])
        .args(["--accept-source-agreements", "--accept-package-agreements"])
        .run_inherited_code()
        .await?;
    if code != Some(0) && code != Some(WINGET_ALREADY_INSTALLED) {
        eprintln!("WARNING: winget install returned {code:?} - verify Multipass install manually.");
    }
    Ok(())
}

async fn wait_for_enter() {
    println!("\nPress Enter to close this elevated window...");
    BufReader::new(tokio::io::stdin())
        .read_line(&mut String::new())
        .await
        .ok();
}

pub(super) async fn run() -> Result<(), ReleaseError> {
    if !is_elevated().await {
        return relaunch_elevated().await;
    }
    let is_restart_needed = needs_restart().await?;
    install_multipass().await?;
    println!();
    if is_restart_needed {
        println!("Hyper-V enablement requires a REBOOT before Multipass can launch a VM.");
        println!("Reboot, then run: ytdl release linux-vm setup");
    } else {
        println!("No reboot needed. Run: ytdl release linux-vm setup");
    }
    wait_for_enter().await;
    Ok(())
}
