//! In-memory stand-ins for the host, the browser and the disk, each logging what the loop asked
//! for so a test can assert on order and timing.

use std::collections::{BTreeMap, VecDeque};
use std::future::{ready, Future};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tokio::time::Instant;

use crate::bridge::protocol::{
    ChangedOutputs, EntrypointLayout, RebuildHmrResult, ReloadExtensionParams,
};
use crate::bridge::Host;
use crate::changes::classifier::ScriptOutputs;
use crate::changes::workspace::{BuildArtifacts, ScriptSnapshot, Workspace};
use crate::driver::BrowserDriver;
use crate::error::{Error, Result};
use crate::hmr_server::ManifestExtras;
use crate::types::{ContentHash, RelPath};

#[derive(Clone, Default)]
pub(super) struct Log(Arc<Mutex<Vec<(Instant, String)>>>);

impl Log {
    pub(super) fn push(&self, entry: impl Into<String>) {
        self.0.lock().unwrap().push((Instant::now(), entry.into()));
    }

    pub(super) fn entries(&self) -> Vec<String> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .map(|(_, entry)| entry.clone())
            .collect()
    }

    pub(super) fn time_of(&self, entry: &str, nth: usize) -> Instant {
        let log = self.0.lock().unwrap();
        log.iter()
            .filter(|(_, text)| text == entry)
            .nth(nth)
            .unwrap()
            .0
    }

    pub(super) fn count(&self, entry: &str) -> usize {
        self.entries().iter().filter(|text| *text == entry).count()
    }
}

#[derive(Clone)]
pub(super) struct FakeHost {
    pub(super) log: Log,
    pub(super) layout: Option<EntrypointLayout>,
    pub(super) build_failures: Arc<Mutex<VecDeque<String>>>,
    pub(super) disk: Arc<Mutex<DiskState>>,
}

impl Host for FakeHost {
    fn build_extension(&self) -> impl Future<Output = Result<Option<EntrypointLayout>>> + Send {
        ready({
            self.log.push("build");
            let mut disk = self.disk.lock().unwrap();
            if disk.snapshots.len() > 1 {
                disk.snapshots.pop_front();
            }
            let failure = self.build_failures.lock().unwrap().pop_front();
            match failure {
                Some(message) => Err(Error::Host { message }),
                None => Ok(self.layout.clone()),
            }
        })
    }

    fn rebuild_hmr(&self) -> impl Future<Output = Result<RebuildHmrResult>> + Send {
        ready({
            self.log.push("rebuildHmr");
            Ok(RebuildHmrResult {
                hmr_source_files: vec![RelPath::new("src/graph.ts")],
            })
        })
    }

    fn reload_extension(
        &self,
        params: ReloadExtensionParams,
    ) -> impl Future<Output = Result<()>> + Send {
        ready({
            self.log.push("reload");
            self.disk.lock().unwrap().reloads.push(params.changed);
            Ok(())
        })
    }

    fn inject_hmr(&self) -> impl Future<Output = Result<bool>> + Send {
        ready({
            self.log.push("inject");
            Ok(true)
        })
    }

    fn refresh_env(&self) -> impl Future<Output = Result<()>> + Send {
        ready({
            self.log.push("env");
            Ok(())
        })
    }
}

#[derive(Clone)]
pub(super) struct FakeDriver {
    pub(super) log: Log,
    pub(super) is_browser_alive: Arc<AtomicBool>,
}

impl BrowserDriver for FakeDriver {
    fn reload_youtube_tabs(&self) -> impl Future<Output = Result<usize>> + Send {
        ready({
            self.log.push("tabs");
            Ok(1)
        })
    }

    fn reload_extension_pages(
        &self,
        entrypoint: &str,
    ) -> impl Future<Output = Result<bool>> + Send {
        ready({
            self.log.push(format!("pages:{entrypoint}"));
            Ok(true)
        })
    }

    fn is_alive(&self) -> impl Future<Output = bool> + Send {
        ready(self.is_browser_alive.load(Ordering::SeqCst))
    }
}

#[derive(Default)]
pub(super) struct DiskState {
    pub(super) public: BTreeMap<String, Vec<u8>>,
    pub(super) output: BTreeMap<String, Vec<u8>>,
    /// The output directory's script state, front first; every build, failed or not, advances it.
    pub(super) snapshots: VecDeque<ScriptSnapshot>,
    pub(super) lockfile: Option<ContentHash>,
    pub(super) extras: Vec<ManifestExtras>,
    pub(super) catalogs: BTreeMap<RelPath, Value>,
    pub(super) is_manifest_missing: bool,
    /// What each extension reload was told changed.
    pub(super) reloads: Vec<ChangedOutputs>,
}

#[derive(Clone)]
pub(super) struct FakeFiles {
    pub(super) log: Log,
    pub(super) state: Arc<Mutex<DiskState>>,
}

impl Workspace for FakeFiles {
    fn script_snapshot(&self) -> impl Future<Output = Result<ScriptSnapshot>> + Send {
        ready({
            self.log.push("snapshot");
            let current = self.state.lock().unwrap().snapshots.front().cloned();
            Ok(current.unwrap_or_else(|| snapshot(b"", b"")))
        })
    }

    fn read_public_file(
        &self,
        path: &RelPath,
    ) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send {
        ready({
            Ok(self
                .state
                .lock()
                .unwrap()
                .public
                .get(path.as_str())
                .cloned())
        })
    }

    fn read_output(&self, relative: &str) -> impl Future<Output = Result<Option<Vec<u8>>>> + Send {
        ready(Ok(self.state.lock().unwrap().output.get(relative).cloned()))
    }

    fn write_output(
        &self,
        relative: &str,
        bytes: Vec<u8>,
    ) -> impl Future<Output = Result<()>> + Send {
        ready({
            self.state
                .lock()
                .unwrap()
                .output
                .insert(relative.to_owned(), bytes);
            Ok(())
        })
    }

    fn write_manifest_extras(
        &self,
        extras: ManifestExtras,
    ) -> impl Future<Output = Result<()>> + Send {
        ready({
            self.state.lock().unwrap().extras.push(extras);
            Ok(())
        })
    }

    fn manifest_payload(&self) -> impl Future<Output = Result<Option<Arc<str>>>> + Send {
        ready(Ok(Some(Arc::from(r#"{"type":"manifest"}"#))))
    }

    fn installed_lockfile_hash(&self) -> impl Future<Output = Result<Option<ContentHash>>> + Send {
        ready(Ok(self.state.lock().unwrap().lockfile.clone()))
    }

    fn locale_catalogs(&self) -> impl Future<Output = Result<BTreeMap<RelPath, Value>>> + Send {
        ready(Ok(self.state.lock().unwrap().catalogs.clone()))
    }

    fn build_artifacts(&self) -> impl Future<Output = Result<Option<BuildArtifacts>>> + Send {
        ready({
            let is_manifest_missing = self.state.lock().unwrap().is_manifest_missing;
            Ok((!is_manifest_missing).then_some(BuildArtifacts {
                manifest_bytes: 1,
                hmr_file_count: 1,
            }))
        })
    }
}

pub(super) fn snapshot(background: &[u8], main_world: &[u8]) -> ScriptSnapshot {
    let file = RelPath::new("bg.js");
    ScriptSnapshot {
        outputs: ScriptOutputs {
            background_files: vec![file.clone()],
            content_script_files: Vec::new(),
        },
        hashes: BTreeMap::from([(file, ContentHash::from_bytes(background))]),
        main_world: ContentHash::from_bytes(main_world),
    }
}
