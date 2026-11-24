//! Sidecar binary of the `YouTube` Downloader extension dev server: reads the config line from stdin, then speaks
//! the bridge protocol on stdio. See the library documentation.

use std::process::ExitCode;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::runtime::Runtime;
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;
use ytdl_dev_hot::bridge::connect;
use ytdl_dev_hot::bridge::logging;
use ytdl_dev_hot::bridge::protocol::{decode_line, SidecarConfig};
use ytdl_dev_hot::changes::watcher::{self, WatchConfig};
use ytdl_dev_hot::changes::workspace::DiskWorkspace;
use ytdl_dev_hot::driver::Driver;
use ytdl_dev_hot::error::Result;
use ytdl_dev_hot::hmr_server;
use ytdl_dev_hot::orchestrator::{run, Deps};

/// How long the writer task gets to flush the final log lines.
const PUMP_JOIN_TIMEOUT: Duration = Duration::from_secs(2);

/// How long the runtime may take to stop its blocking threads. The stdin reader sits in a blocking
/// read until the launcher closes the pipe, and must not keep the process alive.
const RUNTIME_STOP_TIMEOUT: Duration = Duration::from_millis(500);

fn main() -> ExitCode {
    let runtime = match Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("ytdl-dev-hot: {error}");
            return ExitCode::FAILURE;
        }
    };
    let outcome = runtime.block_on(start());
    runtime.shutdown_timeout(RUNTIME_STOP_TIMEOUT);
    match outcome {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("ytdl-dev-hot: {error}");
            ExitCode::FAILURE
        }
    }
}

async fn start() -> Result<()> {
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut first_line = String::new();
    stdin.read_line(&mut first_line).await?;
    let config: SidecarConfig = decode_line(&first_line)?;
    let shutdown = CancellationToken::new();
    let link = connect(stdin, tokio::io::stdout(), shutdown.clone())?;
    logging::install(link.client.log_layer())?;

    let hmr = hmr_server::serve(config.hmr_port, &config.output_dir, shutdown.clone()).await?;
    tracing::info!(
        "HMR push channel listening on ws://127.0.0.1:{}",
        config.hmr_port.get()
    );
    let changes = watcher::spawn(
        WatchConfig {
            root: config.project_root.clone(),
            paths: config.watch_paths.clone(),
            poll_interval: Duration::from_millis(config.poll_interval_ms),
            debounce: Duration::from_millis(config.debounce_ms),
        },
        shutdown.clone(),
    )?;
    let epoch_origin_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(0));
    let deps = Deps {
        host: link.client,
        driver: Driver::from_config(&config)?,
        workspace: DiskWorkspace::new(
            config.project_root.clone(),
            config.output_dir.clone(),
            config.installed_lockfile.clone(),
        ),
        hmr,
        config,
        changes,
        notifications: link.notifications,
        epoch_origin_ms,
    };
    let outcome = run(deps, shutdown.clone()).await;
    shutdown.cancel();
    let _ = timeout(PUMP_JOIN_TIMEOUT, link.pump).await;
    outcome
}
