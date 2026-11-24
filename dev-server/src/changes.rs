//! Source changes: the polling watcher, the pure classification of a change into a reload
//! decision, and the disk access behind it.

use std::io::ErrorKind;
use std::path::Path;

use crate::error::Result;

pub mod classifier;
pub mod watcher;
pub mod workspace;

/// The extension manifest's file name inside the build output.
pub(crate) const MANIFEST_FILE_NAME: &str = "manifest.json";

/// File bytes, `None` when the file does not exist. Blocking.
fn read_optional(path: &Path) -> Result<Option<Vec<u8>>> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}
