//! A warm Node process that runs the WXT build: starting Node and loading WXT and Vite costs about
//! two seconds, which a persistent worker pays once instead of on every rebuild.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

use super::error::{LauncherError, Result};

const WORKER_SOURCE: &str = include_str!("../../../assets/dev/wxt-build-worker.mjs");
const WORKER_FILE: &str = "wxt-build-worker.mjs";
const WORKER_DIRECTORY: [&str; 3] = ["node_modules", ".cache", "ytdl-wxt"];
const NODE_COMMAND: &str = "node";
const WXT_CONFIG_FILE: &str = "wxt.config.ts";

/// What one build needs; the environment is fixed when the worker starts.
pub(super) struct WxtBuildRequest<'request> {
    pub(super) project_root: &'request Path,
    pub(super) browser: &'request str,
    pub(super) config_file: Option<&'request Path>,
    pub(super) environment: Vec<(OsString, OsString)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest<'request> {
    root: &'request Path,
    browser: &'request str,
    config_file: Option<&'request Path>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum WorkerReply {
    Done,
    Failed { message: String },
}

struct WxtWorker {
    process: Child,
    stdin: ChildStdin,
    stdout_lines: Lines<BufReader<ChildStdout>>,
    config_modified: Option<SystemTime>,
    environment: Vec<(OsString, OsString)>,
}

static WARM_WORKER: LazyLock<Mutex<Option<WxtWorker>>> = LazyLock::new(|| Mutex::new(None));

async fn config_modified(project_root: &Path) -> Option<SystemTime> {
    let metadata = fs::metadata(project_root.join(WXT_CONFIG_FILE))
        .await
        .ok()?;
    metadata.modified().ok()
}

async fn ensure_script(project_root: &Path) -> Result<PathBuf> {
    let directory = WORKER_DIRECTORY
        .iter()
        .fold(project_root.to_path_buf(), |path, part| path.join(part));
    let script = directory.join(WORKER_FILE);
    let is_current = fs::read_to_string(&script)
        .await
        .is_ok_and(|existing| existing == WORKER_SOURCE);
    if !is_current {
        fs::create_dir_all(&directory).await?;
        fs::write(&script, WORKER_SOURCE).await?;
    }
    Ok(script)
}

async fn spawn(request: &WxtBuildRequest<'_>) -> Result<WxtWorker> {
    let script = ensure_script(request.project_root).await?;
    let mut command = Command::new(NODE_COMMAND);
    command
        .arg(&script)
        .current_dir(request.project_root)
        .envs(request.environment.iter().map(|(key, value)| (key, value)))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    let mut process = command.spawn()?;
    let (Some(stdin), Some(stdout)) = (process.stdin.take(), process.stdout.take()) else {
        return Err(LauncherError::Invalid(
            "the WXT worker has no stdio".to_owned(),
        ));
    };
    Ok(WxtWorker {
        process,
        stdin,
        stdout_lines: BufReader::new(stdout).lines(),
        config_modified: config_modified(request.project_root).await,
        environment: request.environment.clone(),
    })
}

async fn is_reusable(worker: &mut WxtWorker, request: &WxtBuildRequest<'_>) -> bool {
    let is_alive = matches!(worker.process.try_wait(), Ok(None));
    let is_same_environment = worker.environment == request.environment;
    let is_config_unchanged = worker.config_modified == config_modified(request.project_root).await;
    is_alive && is_same_environment && is_config_unchanged
}

async fn converse(worker: &mut WxtWorker, request: &WxtBuildRequest<'_>) -> Result<()> {
    let line = serde_json::to_string(&WorkerRequest {
        root: request.project_root,
        browser: request.browser,
        config_file: request.config_file,
    })?;
    worker.stdin.write_all(line.as_bytes()).await?;
    worker.stdin.write_all(b"\n").await?;
    worker.stdin.flush().await?;
    let Some(reply) = worker.stdout_lines.next_line().await? else {
        return Err(LauncherError::Invalid(
            "the WXT worker exited mid-build".to_owned(),
        ));
    };
    match serde_json::from_str::<WorkerReply>(&reply)? {
        WorkerReply::Done => Ok(()),
        WorkerReply::Failed { message } => Err(LauncherError::Invalid(message)),
    }
}

/// Runs one WXT build on the warm worker, starting it (or restarting it after a config or
/// environment change) when needed. A worker whose build failed is kept: WXT reports build errors
/// as exceptions, not as a broken process.
pub(super) async fn run_wxt_build(request: &WxtBuildRequest<'_>) -> Result<()> {
    let mut slot = WARM_WORKER.lock().await;
    let mut warm = slot.take();
    let is_warm_reusable = match warm.as_mut() {
        Some(candidate) => is_reusable(candidate, request).await,
        None => false,
    };
    let mut worker = match warm {
        Some(candidate) if is_warm_reusable => candidate,
        _ => spawn(request).await?,
    };
    let outcome = converse(&mut worker, request).await;
    if outcome.as_ref().is_ok() || matches!(outcome, Err(LauncherError::Invalid(_))) {
        *slot = Some(worker);
    }
    outcome
}
