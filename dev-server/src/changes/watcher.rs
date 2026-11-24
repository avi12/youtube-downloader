//! File watching with debounce.
//!
//! Replaces the chokidar block at the end of `runDevServer` (the replaced TypeScript dev server, `chokidar.watch([...])`
//! with `usePolling: true, interval: 500, ignoreInitial: true, cwd: PROJECT_ROOT`) and the debounce
//! half of `scheduleRebuild` (`REBUILD_DEBOUNCE_MS = 800`, each event restarts the timer, the
//! batch fires once the paths have been quiet).
//!
//! - [`notify::PollWatcher`] (mtime and size snapshots) is used, never the native backend: file
//!   reads by the build, the TS server or a search must not register as edits.
//! - `node_modules` is never walked; the install marker is watched as a single file.
//! - Paths that do not exist yet are retried every poll interval and reported once they appear.
//! - notify compares modified times in whole seconds, so an edit within a second of the previous
//!   scan would be missed; content hashing is switched on to catch those (reads still never count).
//! - No initial scan events (`ignoreInitial`); directory events are dropped, only files count.
//! - Paths are emitted relative to the project root as [`RelPath`], deduplicated per batch.
//! - notify's callback runs on its own thread and hands events to the async side through a bounded
//!   channel; the debounce itself is the pure [`Debouncer`], driven by an injected clock.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::time::Duration;

use notify::event::EventKind;
use notify::{Config, PollWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::error::Result;
use crate::types::RelPath;

mod debounce;
mod paths;

pub use debounce::Debouncer;
use debounce::{run_loop, LoopTiming};
pub use paths::relativize;

/// Capacity of the batch channel.
pub const BATCH_CHANNEL_CAPACITY: usize = 16;
/// Capacity of the channel from notify's thread to the debounce loop.
pub const RAW_EVENT_CHANNEL_CAPACITY: usize = 1024;

/// What happened to a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum ChangeKind {
    /// Created or written.
    Modified,
    /// Deleted.
    Removed,
}

/// One changed path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeEvent {
    /// Project-relative path.
    pub path: RelPath,
    /// What happened.
    pub kind: ChangeKind,
}

/// The paths that changed during one quiet-period window, in first-seen order, one event per path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChangeBatch {
    /// The events.
    pub events: Vec<ChangeEvent>,
}

/// What to watch and how.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchConfig {
    /// The project root events are made relative to.
    pub root: PathBuf,
    /// Project-relative files and directories to watch.
    pub paths: Vec<RelPath>,
    /// The polling interval.
    pub poll_interval: Duration,
    /// Quiet time before a batch is emitted.
    pub debounce: Duration,
}

fn change_kind(kind: EventKind) -> Option<ChangeKind> {
    match kind {
        EventKind::Create(_) | EventKind::Modify(_) => Some(ChangeKind::Modified),
        EventKind::Remove(_) => Some(ChangeKind::Removed),
        _ => None,
    }
}

/// notify's callback: keeps the file events under a watch path and hands them to the async side.
fn event_handler(
    root: PathBuf,
    watches: Vec<RelPath>,
    sender: mpsc::Sender<ChangeEvent>,
) -> impl Fn(notify::Result<notify::Event>) + Send + 'static {
    move |result| {
        let event = match result {
            Ok(event) => event,
            Err(error) => {
                tracing::warn!("watcher error: {error}");
                return;
            }
        };
        let Some(kind) = change_kind(event.kind) else {
            return;
        };
        let changes = event
            .paths
            .iter()
            .filter(|path| !path.is_dir())
            .filter_map(|path| relativize(&root, &watches, path));
        for path in changes {
            if sender.blocking_send(ChangeEvent { path, kind }).is_err() {
                return;
            }
        }
    }
}

/// Starts watching; batches arrive on the returned receiver until `shutdown` is cancelled, which
/// also stops the watcher and closes the channel.
///
/// Existing watch paths are registered before this returns (a one-off stat scan of the tree);
/// missing ones are picked up later.
pub fn spawn(
    config: WatchConfig,
    shutdown: CancellationToken,
) -> Result<mpsc::Receiver<ChangeBatch>> {
    let (raw_sender, raw_receiver) = mpsc::channel(RAW_EVENT_CHANNEL_CAPACITY);
    let (batch_sender, batch_receiver) = mpsc::channel(BATCH_CHANNEL_CAPACITY);

    let handler = event_handler(config.root.clone(), config.paths.clone(), raw_sender);
    let poll_config = Config::default()
        .with_poll_interval(config.poll_interval)
        .with_compare_contents(true);
    let mut watcher = PollWatcher::new(handler, poll_config)?;

    let mut missing = Vec::new();
    for relative in &config.paths {
        let absolute = config.root.join(relative.as_str());
        match std::fs::metadata(&absolute) {
            Ok(_) => watcher.watch(&absolute, RecursiveMode::Recursive)?,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                missing.push((relative.clone(), absolute));
            }
            Err(error) => return Err(error.into()),
        }
    }

    let root = config.root;
    let on_tick = move || appeared_paths(&mut watcher, &mut missing, &root);
    tokio::spawn(run_loop(
        raw_receiver,
        batch_sender,
        LoopTiming {
            debounce: config.debounce,
            tick: config.poll_interval,
        },
        on_tick,
        shutdown,
    ));
    Ok(batch_receiver)
}

/// Registers the missing paths that exist now and reports each as a creation. Each check is one
/// `stat`, cheap enough to run on the async side every poll interval.
fn appeared_paths(
    watcher: &mut PollWatcher,
    missing: &mut Vec<(RelPath, PathBuf)>,
    root: &Path,
) -> Vec<ChangeEvent> {
    let mut appeared = Vec::new();
    missing.retain(|(relative, absolute)| {
        if std::fs::metadata(absolute).is_err() {
            return true;
        }
        if let Err(error) = watcher.watch(absolute, RecursiveMode::Recursive) {
            tracing::warn!(
                "cannot watch {} under {}: {error}",
                relative.as_str(),
                root.display()
            );
            return true;
        }
        appeared.push(ChangeEvent {
            path: relative.clone(),
            kind: ChangeKind::Modified,
        });
        false
    });
    appeared
}
