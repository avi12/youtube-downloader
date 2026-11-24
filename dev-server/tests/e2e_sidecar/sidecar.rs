//! The real sidecar binary with a fake TypeScript peer on its stdio that answers every request like
//! the launcher would and records what was asked.

use std::net::TcpListener as StdListener;
use std::path::PathBuf;
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdout, Command};
use tokio::sync::mpsc;
use tokio::time::timeout;
use ytdl_dev_hot::bridge::protocol::{
    decode_line, encode_line, HostRequest, Notification, OutboundMessage, RebuildHmrResult,
    RequestEnvelope, Response,
};
use ytdl_dev_hot::types::RelPath;

use crate::browser::{start_browser, Calls, FakeBrowser};
use crate::hmr_client::HmrClient;
use crate::project::{write_file, Project};
use crate::{eventually, DEBOUNCE_MS, FILE_POLL_MS, WAIT};

fn free_port() -> u16 {
    StdListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

pub(crate) struct Sidecar {
    child: Child,
    to_child: mpsc::Sender<String>,
    calls: Calls,
}

impl Sidecar {
    pub(crate) fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }

    pub(crate) fn count(&self, call: &str) -> usize {
        self.calls()
            .iter()
            .filter(|text| text.starts_with(call))
            .count()
    }

    pub(crate) async fn saw(&self, call: &str) {
        eventually(call, || (self.count(call) > 0).then_some(())).await;
    }

    pub(crate) async fn shutdown(mut self) -> ExitStatus {
        self.to_child
            .send(encode_line(&Notification::Shutdown).unwrap())
            .await
            .unwrap();
        timeout(WAIT, self.child.wait()).await.unwrap().unwrap()
    }
}

pub(crate) struct Scenario {
    pub(crate) project: Project,
    pub(crate) browser: FakeBrowser,
    pub(crate) is_build_bumping_scripts: Arc<AtomicBool>,
    hmr_port: u16,
}

async fn spawn_sidecar(scenario: &Scenario) -> Sidecar {
    let project = &scenario.project;
    let config = json!({
        "projectRoot": project.root, "outputDir": project.output, "browser": "chromium",
        "debugPort": scenario.browser.port, "hmrPort": scenario.hmr_port,
        "watchPaths": ["src", ".env", "../node_modules/.modules.yaml"],
        "envFiles": [".env"], "installMarker": "../node_modules/.modules.yaml",
        "installedLockfile": project.base.join("node_modules/.pnpm/lock.yaml"),
        "skippedEntrypoints": [], "htmlEntrypoints": [], "debounceMs": DEBOUNCE_MS,
        "pollIntervalMs": FILE_POLL_MS
    });
    let mut child = Command::new(env!("CARGO_BIN_EXE_ytdl-dev-hot"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let (to_child, mut outgoing) = mpsc::channel::<String>(16);
    to_child.send(encode_line(&config).unwrap()).await.unwrap();
    tokio::spawn(async move {
        while let Some(line) = outgoing.recv().await {
            stdin.write_all(line.as_bytes()).await.unwrap();
        }
    });
    let calls = Calls::default();
    tokio::spawn(answer_requests(
        stdout,
        Peer {
            to_child: to_child.clone(),
            calls: Arc::clone(&calls),
            output: project.output.clone(),
            is_build_bumping_scripts: Arc::clone(&scenario.is_build_bumping_scripts),
        },
    ));
    Sidecar {
        child,
        to_child,
        calls,
    }
}

/// The fake launcher's side of the bridge.
struct Peer {
    to_child: mpsc::Sender<String>,
    calls: Calls,
    output: PathBuf,
    is_build_bumping_scripts: Arc<AtomicBool>,
}

impl Peer {
    /// The call log entry of a request: its wire method name, plus the diff for a reload.
    fn label(request: &HostRequest) -> String {
        let method = serde_json::to_value(request).unwrap()["method"]
            .as_str()
            .unwrap()
            .to_owned();
        let HostRequest::ReloadExtension(params) = request else {
            return method;
        };
        format!(
            "{method} background={} mainWorld={}",
            params.changed.is_background_changed,
            params.changed.is_main_world_content_script_changed
        )
    }

    /// What the launcher answers, after rewriting the script outputs when the build should move them.
    fn answer(&self, request: &HostRequest) -> Value {
        match request {
            HostRequest::BuildExtension => {
                if self.is_build_bumping_scripts.swap(false, Ordering::SeqCst) {
                    write_file(&self.output.join("background.js"), "bg v2");
                    write_file(&self.output.join("content-scripts/main.js"), "main v2");
                }
                Value::Null
            }
            HostRequest::RebuildHmr => serde_json::to_value(RebuildHmrResult {
                hmr_source_files: vec![RelPath::new("src/graph.ts")],
            })
            .unwrap(),
            HostRequest::InjectHmr => json!(true),
            _ => Value::Null,
        }
    }
}

async fn answer_requests(stdout: ChildStdout, peer: Peer) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let OutboundMessage::Request(RequestEnvelope { id, request }) = decode_line(&line).unwrap()
        else {
            continue;
        };
        peer.calls.lock().unwrap().push(Peer::label(&request));
        let reply = Response {
            id,
            result: Some(peer.answer(&request)),
            error: None,
        };
        peer.to_child
            .send(encode_line(&reply).unwrap())
            .await
            .unwrap();
    }
}

pub(crate) async fn launch() -> (Scenario, Sidecar, HmrClient) {
    let scenario = Scenario {
        project: Project::new(),
        browser: start_browser().await,
        hmr_port: free_port(),
        is_build_bumping_scripts: Arc::new(AtomicBool::new(false)),
    };
    let sidecar = spawn_sidecar(&scenario).await;
    let hmr = HmrClient::connect(scenario.hmr_port).await;
    sidecar.saw("injectHmr").await;
    hmr.message_with(r#""type":"manifest""#).await;
    (scenario, sidecar, hmr)
}
