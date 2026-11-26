//! `dump`: stream a target's console, log, exception and network lines for a while.

use std::time::Duration;

use clap::{Args, Subcommand};
use tokio::task::JoinSet;
use tokio::time::{timeout_at, Instant};

use super::wire::{
    open_target, render, CdpError, Method, NoParams, PortArg, Result, Session, Style, Targets,
    Wanted, DUMP, MONITOR, SW_LOGS,
};

const MONITOR_DEFAULT_MS: u64 = 30_000;
const PAGE_DEFAULT_MS: u64 = 6_000;
const SW_LOGS_DEFAULT_MS: u64 = 4_000;
const CAPTURE_DEFAULT_SECONDS: u64 = 60;
const MILLIS_PER_SECOND: u64 = 1_000;

const RUNTIME_AND_LOG: [Method; 2] = [Method::RuntimeEnable, Method::LogEnable];
const LOG_AND_RUNTIME: [Method; 2] = [Method::LogEnable, Method::RuntimeEnable];
const PAGE_EVENTS: [Method; 3] = [
    Method::LogEnable,
    Method::RuntimeEnable,
    Method::NetworkEnable,
];

/// Arguments of a dump of one target.
#[derive(Debug, Args)]
pub(crate) struct Stream {
    /// The target's WebSocket debugger URL
    ws_url: String,
}

/// Log streams.
#[derive(Debug, Subcommand)]
pub(crate) enum Dump {
    /// Console, log and exception lines of one target
    Monitor {
        #[command(flatten)]
        target: Stream,
        /// How long to listen, in milliseconds
        #[arg(default_value_t = MONITOR_DEFAULT_MS)]
        duration_ms: u64,
    },
    /// Console, log, exception and selected network lines of one page
    Page {
        #[command(flatten)]
        target: Stream,
        /// How long to listen, in milliseconds
        #[arg(default_value_t = PAGE_DEFAULT_MS)]
        duration_ms: u64,
    },
    /// Console, log and exception lines of a service worker
    SwLogs {
        #[command(flatten)]
        target: Stream,
        /// How long to listen, in milliseconds
        #[arg(default_value_t = SW_LOGS_DEFAULT_MS)]
        duration_ms: u64,
    },
    /// Labelled lines of the service worker, the offscreen document and the watch page at once
    Capture {
        #[command(flatten)]
        port: PortArg,
        /// How long to listen, in seconds
        #[arg(default_value_t = CAPTURE_DEFAULT_SECONDS)]
        duration_seconds: u64,
    },
}

/// Runs one `dump` command.
pub(crate) async fn run(command: Dump) -> Result<()> {
    match command {
        Dump::Monitor {
            target,
            duration_ms,
        } => {
            stream(
                &target.ws_url,
                &RUNTIME_AND_LOG,
                MONITOR,
                None,
                millis(duration_ms),
            )
            .await
        }
        Dump::Page {
            target,
            duration_ms,
        } => {
            stream(
                &target.ws_url,
                &PAGE_EVENTS,
                DUMP,
                None,
                millis(duration_ms),
            )
            .await
        }
        Dump::SwLogs {
            target,
            duration_ms,
        } => {
            stream(
                &target.ws_url,
                &LOG_AND_RUNTIME,
                SW_LOGS,
                None,
                millis(duration_ms),
            )
            .await
        }
        Dump::Capture {
            port,
            duration_seconds,
        } => {
            let duration = millis(duration_seconds.saturating_mul(MILLIS_PER_SECOND));
            capture(&port.targets().await?, duration).await
        }
    }
}

const fn millis(count: u64) -> Duration {
    Duration::from_millis(count)
}

async fn stream(
    url: &str,
    enable: &[Method],
    style: Style,
    label: Option<&str>,
    duration: Duration,
) -> Result<()> {
    let mut session = Session::open(url).await?;
    let outcome = listen(&mut session, enable, style, label, duration).await;
    session.close().await;
    outcome
}

async fn listen(
    session: &mut Session,
    enable: &[Method],
    style: Style,
    label: Option<&str>,
    duration: Duration,
) -> Result<()> {
    for method in enable {
        session.call(*method, &NoParams {}).await?;
    }
    let deadline = Instant::now() + duration;
    while let Ok(next) = timeout_at(deadline, session.next_event()).await {
        let Some(event) = next? else {
            break;
        };
        if let Some(line) = render(&event, style, label) {
            println!("{line}");
        }
    }
    Ok(())
}

async fn capture(targets: &Targets, duration: Duration) -> Result<()> {
    let wanted = [
        ("SW", Wanted::ExtensionWorker),
        ("OFFSCREEN", Wanted::Offscreen),
        ("YT", Wanted::WatchTab),
    ];
    let mut streams = JoinSet::new();
    for (label, kind) in wanted {
        let Some(target) = targets.find(kind) else {
            println!("[{label}] target not found");
            continue;
        };
        let mut session = open_target(target).await?;
        streams.spawn(async move {
            let outcome = listen(
                &mut session,
                &RUNTIME_AND_LOG,
                MONITOR,
                Some(label),
                duration,
            )
            .await;
            session.close().await;
            outcome
        });
    }
    while let Some(joined) = streams.join_next().await {
        joined.map_err(|error| CdpError::Protocol(error.to_string()))??;
    }
    Ok(())
}
