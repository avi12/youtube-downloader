//! The Windows `netsh` port proxies that expose VM ports on the host loopback.

use std::path::Path;

use crate::release::linux_vm::{HOST_CDP_PORT, VM_SOCAT_PORT, VNC_PORT};
use crate::release::process::Invocation;
use crate::release::ReleaseError;

const LISTEN_ADDRESS: &str = "127.0.0.1";
const SCRIPT_NAME: &str = "portproxy-setup.ps1";

/// One host loopback port forwarded to a VM port.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Forward {
    listen_port: u16,
    connect_port: u16,
}

/// The host-to-VM Chrome `DevTools` forward.
pub(super) const CDP: Forward = Forward {
    listen_port: HOST_CDP_PORT,
    connect_port: VM_SOCAT_PORT,
};

/// The host-to-VM VNC forward.
pub(super) const VNC: Forward = Forward {
    listen_port: VNC_PORT,
    connect_port: VNC_PORT,
};

/// The table `netsh` prints for the current IPv4 proxies.
pub(super) async fn show() -> Result<String, ReleaseError> {
    let output = Invocation::new("netsh")
        .args(["interface", "portproxy", "show", "v4tov4"])
        .capture()
        .await?;
    Ok(output.stdout)
}

/// Whether the table already sends `forward` to `address`.
pub(super) fn is_forwarded(table: &str, address: &str, forward: Forward) -> bool {
    let port = forward.connect_port.to_string();
    table.lines().any(|line| {
        let columns: Vec<&str> = line.split_whitespace().collect();
        columns
            .windows(2)
            .any(|pair| pair == [address, port.as_str()])
    })
}

fn script_lines(address: &str, forwards: &[Forward]) -> Vec<String> {
    let deletes = forwards.iter().map(|forward| {
        format!(
            "netsh interface portproxy delete v4tov4 listenport={} listenaddress={LISTEN_ADDRESS}",
            forward.listen_port
        )
    });
    let adds = forwards.iter().map(|forward| {
        format!(
            "netsh interface portproxy add v4tov4 listenport={} listenaddress={LISTEN_ADDRESS} connectport={} connectaddress={address}",
            forward.listen_port, forward.connect_port
        )
    });
    deletes.chain(adds).collect()
}

fn elevation_command(script: &Path) -> String {
    let path = script.display().to_string().replace('\'', "''");
    format!("Start-Process powershell -Verb RunAs -Wait -ArgumentList ('-ExecutionPolicy', 'Bypass', '-NonInteractive', '-File', '{path}')")
}

/// Replaces the proxies of `forwards` with ones pointing at `address`, through one elevated script.
pub(super) async fn apply(address: &str, forwards: &[Forward]) -> Result<(), ReleaseError> {
    let script = std::env::temp_dir().join(SCRIPT_NAME);
    tokio::fs::write(&script, script_lines(address, forwards).join("\r\n")).await?;
    let outcome = Invocation::new("powershell")
        .args(["-c", &elevation_command(&script)])
        .run_inherited_code()
        .await;
    tokio::fs::remove_file(&script).await.ok();
    outcome?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::release::linux_vm::portproxy::*;

    const TABLE: &str = "Listen on ipv4:             Connect to ipv4:\n\nAddress         Port        Address         Port\n--------------- ----------  --------------- ----------\n127.0.0.1       9234        10.0.0.5        9235\n";

    #[test]
    fn a_matching_connect_address_and_port_is_detected() {
        assert!(is_forwarded(TABLE, "10.0.0.5", CDP));
        assert!(!is_forwarded(TABLE, "10.0.0.6", CDP));
        assert!(!is_forwarded(TABLE, "10.0.0.5", VNC));
    }

    #[test]
    fn script_deletes_before_it_adds() {
        let lines = script_lines("10.0.0.5", &[CDP]);
        assert_eq!(lines.len(), 2);
        assert!(lines.first().is_some_and(|line| line.contains("delete")));
        assert!(lines
            .last()
            .is_some_and(|line| line.contains("connectport=9235 connectaddress=10.0.0.5")));
    }
}
