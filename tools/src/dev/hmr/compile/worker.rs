//! Spawns the Node compile worker (Vite and the Svelte compiler, the only parts with no Rust
//! equivalent) and answers its questions while a build runs.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::LazyLock;

use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, Mutex};

use super::preserve_state::StatePatterns;
use super::protocol::{
    TransformRequest, TransformResponse, WorkerJob, WorkerMessage, MODE_DEVELOPMENT,
};
use crate::dev::hmr::analysis::wxt_resolution::{source_with_auto_imports, AutoImport};
use crate::dev::hmr::chunks::BuildOutput;
use crate::dev::hmr::error::{HmrError, Result};

const WORKER_SOURCE: &str = include_str!("../../../../assets/hmr/compile-worker.mjs");
const WORKER_FILE: &str = "compile-worker.mjs";
/// Where the worker lives, under the project so Node resolves `vite` and `svelte` from its
/// `node_modules`.
const WORKER_DIRECTORY: [&str; 3] = ["node_modules", ".cache", "ytdl-hmr"];
const NODE_COMMAND: &str = "node";
const NODE_ENV_VARIABLE: &str = "NODE_ENV";

/// What the worker may ask of Rust: the rewrites that are not bundling.
pub(crate) struct Transforms {
    patterns: StatePatterns,
    auto_imports: Vec<AutoImport>,
}

impl Transforms {
    pub(crate) fn new(auto_imports: Vec<AutoImport>) -> Result<Self> {
        Ok(Self {
            patterns: StatePatterns::new()?,
            auto_imports,
        })
    }

    /// Changes when the auto-import set does, telling a warm worker its cached rewrites are stale.
    pub(crate) fn cache_epoch(&self) -> u64 {
        let mut hasher = DefaultHasher::new();
        format!("{:?}", self.auto_imports).hash(&mut hasher);
        hasher.finish()
    }

    fn answer(&self, request: TransformRequest) -> Result<String> {
        Ok(match request {
            TransformRequest::PreserveLocal { code, key } => {
                self.patterns.preserve_local_state(&code, &key)
            }
            TransformRequest::PreserveModule { code, key } => {
                self.patterns.preserve_module_state(&code, &key)
            }
            TransformRequest::AutoImports { code } => {
                source_with_auto_imports(&code, &self.auto_imports)?
            }
        })
    }
}

/// Writes the embedded worker next to the project's `node_modules` when it changed.
async fn ensure_worker_script(project_root: &Path) -> Result<PathBuf> {
    let directory = WORKER_DIRECTORY
        .iter()
        .fold(project_root.to_path_buf(), |path, part| path.join(part));
    let script = directory.join(WORKER_FILE);
    let is_current = fs::read_to_string(&script)
        .await
        .is_ok_and(|existing| existing == WORKER_SOURCE);
    if is_current {
        return Ok(script);
    }
    fs::create_dir_all(&directory).await?;
    fs::write(&script, WORKER_SOURCE).await?;
    Ok(script)
}

async fn write_line(stdin: &mut ChildStdin, line: &str) -> Result<()> {
    stdin.write_all(line.as_bytes()).await?;
    stdin.write_all(b"\n").await?;
    stdin.flush().await?;
    Ok(())
}

/// Feeds the worker's stdin from a queue on its own task. Node writes a pipe synchronously on
/// Windows, so a read loop that also waits on its writes deadlocks once both pipes fill.
fn spawn_stdin_writer(mut stdin: ChildStdin) -> mpsc::UnboundedSender<String> {
    let (sender, mut queue) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(line) = queue.recv().await {
            if write_line(&mut stdin, &line).await.is_err() {
                return;
            }
        }
    });
    sender
}

async fn exit_description(child: &mut Child) -> String {
    match child.wait().await {
        Ok(status) => status.to_string(),
        Err(error) => error.to_string(),
    }
}

/// Which of the two builds a worker serves; each keeps its own warm process and caches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum WorkerRole {
    Entries,
    MainWorld,
}

/// A live Node worker: it outlives builds so Node and Vite start once and its caches stay warm.
struct Worker {
    process: Child,
    stdin_queue: mpsc::UnboundedSender<String>,
    stdout_lines: Lines<BufReader<ChildStdout>>,
}

static IDLE_WORKERS: LazyLock<Mutex<HashMap<WorkerRole, Worker>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

async fn spawn_worker(project_root: &Path) -> Result<Worker> {
    let script = ensure_worker_script(project_root).await?;
    let mut child = Command::new(NODE_COMMAND)
        .arg(&script)
        .current_dir(project_root)
        .env(NODE_ENV_VARIABLE, MODE_DEVELOPMENT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()?;
    let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        return Err(HmrError::WorkerExited("no stdio".to_owned()));
    };
    Ok(Worker {
        process: child,
        stdin_queue: spawn_stdin_writer(stdin),
        stdout_lines: BufReader::new(stdout).lines(),
    })
}

async fn take_worker(role: WorkerRole, project_root: &Path) -> Result<Worker> {
    let idle = IDLE_WORKERS.lock().await.remove(&role);
    match idle {
        Some(worker) => Ok(worker),
        None => spawn_worker(project_root).await,
    }
}

fn send_line(worker: &Worker, line: String) -> Result<()> {
    worker
        .stdin_queue
        .send(line)
        .map_err(|_| HmrError::WorkerExited("stdin closed".to_owned()))
}

async fn converse(
    worker: &mut Worker,
    job: &WorkerJob<'_>,
    transforms: &Transforms,
) -> Result<BuildOutput> {
    send_line(worker, serde_json::to_string(job)?)?;
    while let Some(line) = worker.stdout_lines.next_line().await? {
        match serde_json::from_str::<WorkerMessage>(&line)? {
            WorkerMessage::Request { id, request } => {
                let code = transforms.answer(request)?;
                send_line(
                    worker,
                    serde_json::to_string(&TransformResponse { id, code })?,
                )?;
            }
            WorkerMessage::Done { output } => return Ok(output),
            WorkerMessage::Failed { message } => return Err(HmrError::Worker(message)),
        }
    }
    Err(HmrError::WorkerExited(
        exit_description(&mut worker.process).await,
    ))
}

/// Runs one build on the role's warm worker, starting it on first use. A worker that errored is
/// dropped (and killed), so the next build starts clean.
pub(crate) async fn run_worker(
    role: WorkerRole,
    project_root: &Path,
    job: &WorkerJob<'_>,
    transforms: &Transforms,
) -> Result<BuildOutput> {
    let mut worker = take_worker(role, project_root).await?;
    let output = converse(&mut worker, job, transforms).await?;
    IDLE_WORKERS.lock().await.insert(role, worker);
    Ok(output)
}
