//! The segments of running downloads, held outside the browser so a reload cannot lose them.

mod disk;
mod memory;

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::{Error, Result};

pub use self::disk::DiskStore;
pub use self::memory::MemoryStore;

/// A name that is safe as one path component: ASCII letters, digits, `-` and `_`.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct SafeName(String);

impl SafeName {
    /// Rejects anything that could leave the store's directory.
    pub fn new(raw: impl Into<String>) -> Result<Self> {
        let raw = raw.into();
        let is_safe = !raw.is_empty()
            && raw
                .chars()
                .all(|letter| letter.is_ascii_alphanumeric() || matches!(letter, '-' | '_'));
        if !is_safe {
            return Err(Error::Protocol(format!(
                "unsafe download or track name {raw:?}"
            )));
        }

        Ok(Self(raw))
    }

    /// The name's text.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for SafeName {
    type Error = Error;

    fn try_from(raw: String) -> Result<Self> {
        Self::new(raw)
    }
}

impl From<SafeName> for String {
    fn from(name: SafeName) -> Self {
        name.0
    }
}

/// Which segment of a download: its track, then its position in that track.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SegmentKey {
    /// The track the segment belongs to, such as one audio or video format.
    pub track: SafeName,
    /// The segment's position within its track.
    pub index: u64,
}

/// Where segments are kept. Calls block, so async callers run them under `spawn_blocking`.
pub trait SegmentStore: Send + Sync {
    /// Keeps a whole segment, replacing an earlier copy.
    fn save(&self, download: &SafeName, key: &SegmentKey, bytes: &[u8]) -> Result<()>;

    /// The bytes of a segment, `None` when it was never saved.
    fn load(&self, download: &SafeName, key: &SegmentKey) -> Result<Option<Vec<u8>>>;

    /// Every segment held for a download, in track and position order.
    fn held(&self, download: &SafeName) -> Result<Vec<SegmentKey>>;

    /// Forgets a finished or canceled download.
    fn remove(&self, download: &SafeName) -> Result<()>;
}

/// Where the dev server keeps segments.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Storage {
    /// Files under a directory, which outlive a dev server restart.
    Disk(PathBuf),
    /// The dev server's own memory.
    Memory,
}

impl Storage {
    /// The store of this kind.
    pub fn open(self) -> Box<dyn SegmentStore> {
        match self {
            Self::Disk(root) => Box::new(DiskStore::new(root)),
            Self::Memory => Box::new(MemoryStore::default()),
        }
    }
}
