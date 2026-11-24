//! Small process-environment lookups of the launcher; spawning goes through
//! `crate::release::process::Invocation`.

use std::env;
use std::net::{Ipv4Addr, TcpListener};
use std::path::PathBuf;

use super::error::Result;

/// The first `name` found along `PATH`.
pub(super) fn find_on_path(name: &str) -> Option<PathBuf> {
    let paths = env::var_os("PATH")?;
    env::split_paths(&paths)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

/// A TCP port nothing listens on right now.
pub(super) fn free_port() -> Result<u16> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    Ok(listener.local_addr()?.port())
}
