//! Segments as files: `<root>/<download>/<track>/<index>.segment`.

use std::fs;
use std::io::{self, ErrorKind};
use std::path::{Path, PathBuf};

use super::{SafeName, SegmentKey, SegmentStore};
use crate::Result;

const SEGMENT_EXTENSION: &str = "segment";
/// A segment still being written, which is never reported as held.
const PARTIAL_EXTENSION: &str = "part";

/// A store under one directory.
#[derive(Debug, Clone)]
pub struct DiskStore {
    root: PathBuf,
}

impl DiskStore {
    /// A store under `root`, which is created by the first save.
    pub const fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn path_of(&self, download: &SafeName, key: &SegmentKey) -> PathBuf {
        let mut path = self.root.join(download.as_str());
        path.push(key.track.as_str());
        path.push(format!("{}.{SEGMENT_EXTENSION}", key.index));
        path
    }
}

/// A missing file or directory is an answer, not a failure.
fn or_absent<T>(outcome: io::Result<T>) -> io::Result<Option<T>> {
    match outcome {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn segment_index(path: &Path) -> Option<u64> {
    if path.extension()? != SEGMENT_EXTENSION {
        return None;
    }

    path.file_stem()?.to_str()?.parse().ok()
}

impl SegmentStore for DiskStore {
    fn save(&self, download: &SafeName, key: &SegmentKey, bytes: &[u8]) -> Result<()> {
        let path = self.path_of(download, key);
        if let Some(directory) = path.parent() {
            fs::create_dir_all(directory)?;
        }

        // Renamed into place, so an interrupted write never looks like a whole segment
        let partial = path.with_extension(PARTIAL_EXTENSION);
        fs::write(&partial, bytes)?;
        fs::rename(partial, path)?;
        Ok(())
    }

    fn load(&self, download: &SafeName, key: &SegmentKey) -> Result<Option<Vec<u8>>> {
        Ok(or_absent(fs::read(self.path_of(download, key)))?)
    }

    fn held(&self, download: &SafeName) -> Result<Vec<SegmentKey>> {
        let Some(tracks) = or_absent(fs::read_dir(self.root.join(download.as_str())))? else {
            return Ok(Vec::new());
        };

        let mut keys = Vec::new();
        for track in tracks {
            let track = track?;
            let name = SafeName::new(track.file_name().to_string_lossy())?;
            for segment in fs::read_dir(track.path())? {
                let Some(index) = segment_index(&segment?.path()) else {
                    continue;
                };

                keys.push(SegmentKey {
                    track: name.clone(),
                    index,
                });
            }
        }

        keys.sort();
        Ok(keys)
    }

    fn remove(&self, download: &SafeName) -> Result<()> {
        or_absent(fs::remove_dir_all(self.root.join(download.as_str())))?;
        Ok(())
    }
}
