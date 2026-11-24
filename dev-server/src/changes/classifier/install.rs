//! Telling a real dependency install apart from a no-op one.

use std::path::Path;

use crate::changes::read_optional;
use crate::error::Result;
use crate::types::ContentHash;

/// Remembers the installed dependency set so a no-op install (a store prune, another workspace's
/// command) is told apart from a real one. Port of `installedLockfileHash` and `isInstallChange`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct InstallGate {
    last: Option<ContentHash>,
}

impl InstallGate {
    /// A gate that starts from the hash taken at startup (`None` when the lockfile is absent).
    pub const fn new(initial: Option<ContentHash>) -> Self {
        Self { last: initial }
    }

    /// Whether `current` differs from the last seen hash; remembers `current` either way.
    ///
    /// ```
    /// use ytdl_dev_hot::changes::classifier::InstallGate;
    /// use ytdl_dev_hot::types::ContentHash;
    ///
    /// let mut gate = InstallGate::new(Some(ContentHash::from_bytes(b"a")));
    /// assert!(!gate.is_dependency_set_changed(Some(ContentHash::from_bytes(b"a"))));
    /// assert!(gate.is_dependency_set_changed(Some(ContentHash::from_bytes(b"b"))));
    /// assert!(!gate.is_dependency_set_changed(Some(ContentHash::from_bytes(b"b"))));
    /// ```
    pub fn is_dependency_set_changed(&mut self, current: Option<ContentHash>) -> bool {
        let is_changed = self.last != current;
        self.last = current;
        is_changed
    }
}

/// Hash of the installed-state lockfile, `None` when it does not exist. Blocking.
/// Port of `hashInstalledLockfile`.
pub fn hash_installed_lockfile(lockfile: &Path) -> Result<Option<ContentHash>> {
    Ok(read_optional(lockfile)?.map(|bytes| ContentHash::from_bytes(&bytes)))
}
