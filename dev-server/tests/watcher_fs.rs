//! The watcher against a real directory: a change under a watched tree, and a file that only
//! appears after startup, each arrive as one batch.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use ytdl_dev_hot::changes::watcher::{spawn, ChangeBatch, WatchConfig};
use ytdl_dev_hot::types::RelPath;
use ytdl_dev_hot::Result;

const WAIT: Duration = Duration::from_secs(20);

fn scratch_dir(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("ytdl-watcher-{name}-{}", std::process::id()))
}

fn config(root: &Path) -> WatchConfig {
    WatchConfig {
        root: root.to_path_buf(),
        paths: vec![RelPath::new("src"), RelPath::new(".env.local")],
        poll_interval: Duration::from_millis(50),
        debounce: Duration::from_millis(100),
    }
}

async fn next_paths(batches: &mut tokio::sync::mpsc::Receiver<ChangeBatch>) -> Vec<String> {
    let batch = timeout(WAIT, batches.recv()).await.ok().flatten();
    batch.map_or_else(Vec::new, |found| {
        found
            .events
            .iter()
            .map(|event| event.path.as_str().to_owned())
            .collect()
    })
}

#[tokio::test]
async fn reports_edits_and_late_files_relative_to_the_root() -> Result<()> {
    let root = scratch_dir("fs");
    std::fs::create_dir_all(root.join("src"))?;
    std::fs::write(root.join("src").join("a.ts"), b"1")?;
    let shutdown = CancellationToken::new();
    let mut batches = spawn(config(&root), shutdown.clone())?;
    // Polling compares modified times: let the baseline age past the filesystem clock tick
    tokio::time::sleep(Duration::from_millis(250)).await;

    std::fs::write(root.join("src").join("a.ts"), b"2 and longer")?;
    assert_eq!(next_paths(&mut batches).await, ["src/a.ts"]);

    std::fs::write(root.join(".env.local"), b"KEY=1")?;
    assert_eq!(next_paths(&mut batches).await, [".env.local"]);

    shutdown.cancel();
    assert!(timeout(WAIT, batches.recv())
        .await
        .is_ok_and(|batch| batch.is_none()));
    std::fs::remove_dir_all(&root)?;
    Ok(())
}
