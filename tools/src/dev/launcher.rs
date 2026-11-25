//! The dev server launcher, `ytdl dev run`: production builds and one long-lived browser with the
//! extension sideloaded, kept current by the hot loop of `ytdl_dev_hot`. Replaces
//! `scripts/dev/server/{main,options,profiles,launch,build,log,sidecar}.ts`, `scripts/dev/project.ts`,
//! `scripts/dev/enums.ts` and `scripts/dev-bridge.ts`.
//!
//! Closing the browser ends the server and ending the server closes the browser; only the process
//! this launcher started is ever killed.

mod browser;
mod build;
mod error;
mod host;
mod log;
mod process;
mod wxt_worker;

use std::path::Path;
use std::time::Duration;

use clap::Args;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use ytdl_dev_hot::bridge::protocol::{Notification, SidecarConfig};
use ytdl_dev_hot::changes::watcher::{self, WatchConfig};
use ytdl_dev_hot::changes::workspace::DiskWorkspace;
use ytdl_dev_hot::driver::Driver;
use ytdl_dev_hot::hmr_server;
use ytdl_dev_hot::orchestrator::{run as run_hot_loop, Deps};
use ytdl_dev_hot::types::{BrowserKind, Port, RelPath};

use self::browser::{launch, BrowserLaunch, RunningBrowser};
use self::build::{build_hmr_modules, build_with_lock_retry};
pub(crate) use self::error::LauncherError;
use self::error::Result;
use self::host::{now_epoch_milliseconds, DevHost};
use self::log::install_log_layer;
use crate::output::options::{
    resolve_options, BuildBrowser, DevOptions, HostEnvironment, OptionArgs,
};
use crate::output::profile::{clean_leftover_instances, setup_profile};

const WATCHED_CONFIG_FILE: &str = "wxt.config.ts";
const NOTIFICATION_QUEUE_CAPACITY: usize = 1;
const HOT_LOOP_STOP_TIMEOUT: Duration = Duration::from_secs(5);

/// Arguments of `ytdl dev run`. Each flag falls back to a `YTDL_DEV_*` environment variable, so a
/// second dev server can run beside the first on its own debug port, profile and output dir.
#[derive(Debug, Args)]
pub(crate) struct RunArgs {
    #[command(flatten)]
    options: OptionArgs,
}

/// Runs the dev server until the browser closes or the process is interrupted.
pub(crate) async fn run(args: RunArgs) -> Result<()> {
    Box::pin(start(&args)).await
}

fn browser_name(options: &DevOptions) -> &'static str {
    match options.browser() {
        BuildBrowser::Chrome => "Chrome",
        BuildBrowser::Firefox => "Firefox",
    }
}

async fn start(args: &RunArgs) -> Result<()> {
    let environment = HostEnvironment::detect();
    let options = resolve_options(&args.options, &environment)?;
    std::env::set_current_dir(&options.project_root)?;
    install_log_layer()?;
    clean_leftover_instances(&options, &environment).await?;
    setup_profile(&options, &environment)?;

    let name = browser_name(&options);
    println!("Building extension for {name} (production)...");
    let output_dir = build_with_lock_retry(&options).await?;
    let hmr_source_files = build_hmr_modules(&options, &output_dir)
        .await?
        .source_modules;
    let relative_output = output_dir
        .strip_prefix(&options.project_root)
        .unwrap_or(&output_dir);
    println!("Build complete: {}\n", relative_output.display());

    let running = launch(BrowserLaunch {
        options: &options,
        host: &environment,
        output_dir: &output_dir,
    })
    .await?;
    println!(
        "{name} launched with extension sideloaded (debug port {}, profile {}).",
        options.cdp_port,
        options
            .profile_dir
            .strip_prefix(&options.project_root)
            .unwrap_or(&options.profile_dir)
            .display()
    );
    let target = running.reload_target(&options)?;
    let host = DevHost::new(options.clone(), output_dir.clone(), target)?;
    host.reload_if_background_stale().await?;
    let config = sidecar_config(&options, &running, &output_dir, hmr_source_files)?;
    Box::pin(serve(host, config, running)).await
}

fn relative_paths(paths: &[&str]) -> Vec<RelPath> {
    paths.iter().map(RelPath::new).collect()
}

fn sidecar_config(
    options: &DevOptions,
    running: &RunningBrowser,
    output_dir: &Path,
    hmr_source_files: Vec<RelPath>,
) -> Result<SidecarConfig> {
    let hmr_port = u32::from(options.cdp_port) + options.hmr_port_offset;
    let hmr_port = u16::try_from(hmr_port)
        .map_err(|_| LauncherError::Invalid(format!("the HMR port {hmr_port} is out of range")))?;
    let mut watch_paths = vec!["src", WATCHED_CONFIG_FILE, &options.install_marker_path];
    watch_paths.extend(options.env_files.iter().map(String::as_str));
    Ok(SidecarConfig {
        project_root: options.project_root.clone(),
        output_dir: output_dir.to_owned(),
        browser: match options.browser() {
            BuildBrowser::Chrome => BrowserKind::Chromium,
            BuildBrowser::Firefox => BrowserKind::Firefox,
        },
        debug_port: Port::new(running.debug_port(options))?,
        hmr_port: Port::new(hmr_port)?,
        watch_paths: relative_paths(&watch_paths),
        env_files: options.env_files.iter().map(RelPath::new).collect(),
        install_marker: RelPath::new(&options.install_marker_path),
        installed_lockfile: options.installed_lockfile_path.clone(),
        skipped_entrypoints: Vec::new(),
        html_entrypoints: Vec::new(),
        extension_id: running.firefox.as_ref().map(|id| id.extension_id.clone()),
        extension_uuid: running.firefox.as_ref().map(|id| id.uuid.clone()),
        hmr_source_files,
        is_liveness_monitored: false,
        hmr_reinject_interval_ms: None,
        debounce_ms: u64::from(options.rebuild_debounce_ms),
        poll_interval_ms: u64::from(options.watch_poll_interval_ms),
    })
}

/// Why the session ended.
enum Stop {
    HotLoop(ytdl_dev_hot::Result<()>),
    Interrupted,
    BrowserClosed,
}

async fn serve(host: DevHost, config: SidecarConfig, mut running: RunningBrowser) -> Result<()> {
    let shutdown = CancellationToken::new();
    let hmr = hmr_server::serve(config.hmr_port, &config.output_dir, shutdown.clone()).await?;
    let changes = watcher::spawn(
        WatchConfig {
            root: config.project_root.clone(),
            paths: config.watch_paths.clone(),
            poll_interval: Duration::from_millis(config.poll_interval_ms),
            debounce: Duration::from_millis(config.debounce_ms),
        },
        shutdown.clone(),
    )?;
    let (notification_sender, notifications) =
        mpsc::channel::<Notification>(NOTIFICATION_QUEUE_CAPACITY);
    let deps = Deps {
        host,
        driver: Driver::from_config(&config)?,
        workspace: DiskWorkspace::new(
            config.project_root.clone(),
            config.output_dir.clone(),
            config.installed_lockfile.clone(),
        ),
        hmr,
        config,
        changes,
        notifications,
        epoch_origin_ms: now_epoch_milliseconds(),
    };
    println!("Watching for file changes...\n");
    let hot_loop = run_hot_loop(deps, shutdown.clone());
    tokio::pin!(hot_loop);
    let stop = tokio::select! {
        result = &mut hot_loop => Stop::HotLoop(result),
        () = interrupted() => Stop::Interrupted,
        _ = running.child.wait() => Stop::BrowserClosed,
    };
    if matches!(stop, Stop::BrowserClosed) {
        println!("\nBrowser closed. Exiting.");
    }
    shutdown.cancel();
    let outcome = match stop {
        Stop::HotLoop(result) => result,
        Stop::Interrupted | Stop::BrowserClosed => {
            tokio::time::timeout(HOT_LOOP_STOP_TIMEOUT, hot_loop)
                .await
                .unwrap_or(Ok(()))
        }
    };
    drop(notification_sender);
    // Only the process this launcher started
    let _ = running.child.kill().await;
    Ok(outcome?)
}

#[cfg(unix)]
async fn interrupted() {
    use tokio::signal::unix::{signal, SignalKind};
    let Ok(mut terminate) = signal(SignalKind::terminate()) else {
        let _ = tokio::signal::ctrl_c().await;
        return;
    };
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = terminate.recv() => {}
    }
}

#[cfg(not(unix))]
async fn interrupted() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn watch_paths_name_the_sources_the_config_and_the_env_files() {
        let paths = relative_paths(&["src", WATCHED_CONFIG_FILE, ".env"]);
        let names: Vec<&str> = paths.iter().map(RelPath::as_str).collect();
        assert_eq!(names, ["src", "wxt.config.ts", ".env"]);
    }
}
