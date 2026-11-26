//! A typed view of the `multipass` CLI.

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use crate::release::linux_vm::VM_NAME;
use crate::release::process::Invocation;
use crate::release::ReleaseError;

const UBUNTU_RELEASE: &str = "24.04";
const VM_CPUS: &str = "4";
const VM_MEMORY: &str = "4G";
const VM_DISK: &str = "20G";

#[derive(Debug, Deserialize)]
struct InfoDocument {
    info: BTreeMap<String, VmDetails>,
}

/// The state of a VM.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
enum VmState {
    /// Up.
    Running,
    /// Anything else (stopped, suspended, starting).
    #[serde(other)]
    NotRunning,
}

/// What `multipass info` says about the VM.
#[derive(Debug, Deserialize)]
pub(super) struct VmDetails {
    state: VmState,
    #[serde(default)]
    ipv4: Vec<String>,
    #[serde(default)]
    mounts: Option<BTreeMap<String, serde_json::Value>>,
}

impl VmDetails {
    pub(super) fn is_running(&self) -> bool {
        self.state == VmState::Running
    }

    pub(super) fn address(&self) -> Option<&str> {
        self.ipv4.first().map(String::as_str)
    }

    pub(super) fn has_mount(&self, target: &str) -> bool {
        self.mounts
            .as_ref()
            .is_some_and(|mounts| mounts.contains_key(target))
    }
}

fn multipass() -> Invocation {
    Invocation::new("multipass")
}

pub(super) async fn ensure_installed() -> Result<(), ReleaseError> {
    multipass()
        .arg("version")
        .capture()
        .await
        .map(drop)
        .map_err(|_| ReleaseError::MultipassMissing)
}

/// The VM's details, or `None` when it does not exist.
pub(super) async fn info() -> Result<Option<VmDetails>, ReleaseError> {
    let output = multipass()
        .args(["info", VM_NAME, "--format", "json"])
        .capture()
        .await?;
    if output.stdout.is_empty() {
        return Ok(None);
    }
    let mut document: InfoDocument = serde_json::from_str(&output.stdout)?;
    Ok(document.info.remove(VM_NAME))
}

pub(super) async fn start() -> Result<(), ReleaseError> {
    Ok(multipass().args(["start", VM_NAME]).run_inherited().await?)
}

pub(super) async fn launch() -> Result<(), ReleaseError> {
    println!("Creating VM '{VM_NAME}' (Ubuntu {UBUNTU_RELEASE}, {VM_CPUS} CPU, {VM_MEMORY} RAM, {VM_DISK} disk)...");
    let invocation = multipass()
        .args(["launch", UBUNTU_RELEASE, "--name", VM_NAME])
        .args(["--cpus", VM_CPUS, "--memory", VM_MEMORY, "--disk", VM_DISK]);
    Ok(invocation.run_inherited().await?)
}

pub(super) async fn mount(source: &Path, target: &str) -> Result<(), ReleaseError> {
    let invocation = multipass()
        .arg("mount")
        .arg(source)
        .arg(format!("{VM_NAME}:{target}"))
        .args(["--type", "classic"]);
    Ok(invocation.run_inherited().await?)
}

/// Runs `script` under bash inside the VM, sharing stdio; returns its exit code.
pub(super) async fn run_script(script: &str) -> Result<Option<i32>, ReleaseError> {
    let invocation = multipass()
        .args(["exec", VM_NAME, "--", "bash", "-c"])
        .arg(script);
    Ok(invocation.run_inherited_code().await?)
}

#[cfg(test)]
mod tests {
    use crate::release::linux_vm::multipass::*;

    #[test]
    fn info_reads_state_address_and_mounts() {
        let document: InfoDocument = serde_json::from_str(
            r#"{"errors":[],"info":{"ytdl-linux":{"state":"Running","ipv4":["10.0.0.5"],"mounts":{"/host-repo":{"source_path":"C:\\x"}}}}}"#,
        )
        .unwrap();
        let details = document.info.get("ytdl-linux").unwrap();
        assert!(details.is_running());
        assert_eq!(details.address(), Some("10.0.0.5"));
        assert!(details.has_mount("/host-repo"));
        assert!(!details.has_mount("/other"));
    }

    #[test]
    fn a_stopped_vm_is_not_running_and_has_no_mounts_key() {
        let details: VmDetails = serde_json::from_str(r#"{"state":"Stopped","ipv4":[]}"#).unwrap();
        assert!(!details.is_running());
        assert_eq!(details.address(), None);
    }
}
