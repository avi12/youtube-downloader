//! Starts the loop against the fakes with a config overlay and drives it: touch files, let the
//! paused clock run, stop it.

use std::collections::VecDeque;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;

use super::fakes::{DiskState, FakeDriver, FakeFiles, FakeHost, Log};
use crate::bridge::protocol::{Notification, SidecarConfig};
use crate::changes::watcher::{ChangeBatch, ChangeEvent, ChangeKind};
use crate::error::Result;
use crate::hmr_server::HmrHandle;
use crate::orchestrator::{run, Deps};
use crate::types::RelPath;

const LONG_ENOUGH: Duration = Duration::from_secs(20);

fn config(extra: &Value) -> SidecarConfig {
    let mut base = json!({
        "projectRoot": "/p", "outputDir": "/p/out", "browser": "chromium", "debugPort": 9222,
        "hmrPort": 9260, "watchPaths": ["src"], "envFiles": [".env"],
        "installMarker": "../node_modules/.modules.yaml", "installedLockfile": "/lock",
        "skippedEntrypoints": ["src/entrypoints/grant/"],
        "htmlEntrypoints": [{"name": "popup", "watchPath": "src/entrypoints/popup/"}],
        "hmrSourceFiles": ["src/a.svelte"], "debounceMs": 800, "pollIntervalMs": 500
    });
    if let (Some(target), Some(extra)) = (base.as_object_mut(), extra.as_object()) {
        target.extend(extra.clone());
    }
    serde_json::from_value(base).unwrap()
}

pub(super) struct Harness {
    pub(super) log: Log,
    pub(super) files: FakeFiles,
    pub(super) changes: mpsc::Sender<ChangeBatch>,
    pub(super) notifications: mpsc::Sender<Notification>,
    pub(super) pushes: broadcast::Receiver<Arc<str>>,
    pub(super) is_browser_alive: Arc<AtomicBool>,
    pub(super) build_failures: Arc<Mutex<VecDeque<String>>>,
    pub(super) task: JoinHandle<Result<()>>,
}

pub(super) async fn start(extra: &Value, setup: impl FnOnce(&mut DiskState)) -> Harness {
    let log = Log::default();
    let files = FakeFiles {
        log: log.clone(),
        state: Arc::default(),
    };
    let is_browser_alive = Arc::new(AtomicBool::new(true));
    let build_failures = Arc::<Mutex<VecDeque<String>>>::default();
    let hmr = HmrHandle::new();
    let pushes = hmr.subscribe();
    let (changes, change_receiver) = mpsc::channel(16);
    let (notifications, notification_receiver) = mpsc::channel(4);
    let deps = Deps {
        host: FakeHost {
            log: log.clone(),
            layout: None,
            build_failures: Arc::clone(&build_failures),
            disk: Arc::clone(&files.state),
        },
        driver: FakeDriver {
            log: log.clone(),
            is_browser_alive: Arc::clone(&is_browser_alive),
        },
        workspace: files.clone(),
        hmr,
        config: config(extra),
        changes: change_receiver,
        notifications: notification_receiver,
        epoch_origin_ms: 1_000,
    };
    setup(&mut files.state.lock().unwrap());
    let task = tokio::spawn(run(deps, CancellationToken::new()));
    sleep(Duration::from_millis(1)).await;
    Harness {
        log,
        files,
        changes,
        notifications,
        pushes,
        is_browser_alive,
        build_failures,
        task,
    }
}

impl Harness {
    pub(super) async fn touch(&self, paths: &[&str]) {
        let events = paths
            .iter()
            .map(|path| ChangeEvent {
                path: RelPath::new(path),
                kind: ChangeKind::Modified,
            })
            .collect();
        self.changes.send(ChangeBatch { events }).await.unwrap();
    }

    pub(super) async fn settle(&self) {
        sleep(LONG_ENOUGH).await;
    }

    pub(super) fn drain_pushes(&mut self) -> Vec<String> {
        let mut seen = Vec::new();
        while let Ok(payload) = self.pushes.try_recv() {
            seen.push(payload.to_string());
        }
        seen
    }

    pub(super) async fn stop(self) -> Result<()> {
        self.notifications
            .send(Notification::Shutdown)
            .await
            .unwrap();
        self.task.await.unwrap()
    }
}
