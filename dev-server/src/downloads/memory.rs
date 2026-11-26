//! Segments in the dev server's memory.

use std::collections::BTreeMap;
use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::downloads::{SafeName, SegmentKey, SegmentStore};
use crate::Result;

type Downloads = BTreeMap<SafeName, BTreeMap<SegmentKey, Vec<u8>>>;

/// A store that lives as long as the dev server.
#[derive(Debug, Default)]
pub struct MemoryStore {
    downloads: Mutex<Downloads>,
}

impl MemoryStore {
    // Every change is one map operation, so a poisoned lock still guards a consistent map
    fn lock(&self) -> MutexGuard<'_, Downloads> {
        self.downloads
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

impl SegmentStore for MemoryStore {
    fn save(&self, download: &SafeName, key: &SegmentKey, bytes: &[u8]) -> Result<()> {
        self.lock()
            .entry(download.clone())
            .or_default()
            .insert(key.clone(), bytes.to_vec());
        Ok(())
    }

    fn load(&self, download: &SafeName, key: &SegmentKey) -> Result<Option<Vec<u8>>> {
        Ok(self
            .lock()
            .get(download)
            .and_then(|segments| segments.get(key))
            .cloned())
    }

    fn held(&self, download: &SafeName) -> Result<Vec<SegmentKey>> {
        Ok(self
            .lock()
            .get(download)
            .map_or_default(|segments| segments.keys().cloned().collect()))
    }

    fn remove(&self, download: &SafeName) -> Result<()> {
        self.lock().remove(download);
        Ok(())
    }
}
