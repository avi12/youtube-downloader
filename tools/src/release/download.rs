//! `release verify-download`: one full download cycle in the open `YouTube` watch tab, reported as
//! a JSON line. Exit code 0 on a completed download, non-zero otherwise.

mod browser;
pub(super) mod cherry_pick;
mod flow;
mod log;
mod page;

use std::time::Duration;

use clap::Args as ClapArgs;
use serde::Serialize;
use tokio::time::Instant;
use ytdl_dev_hot::types::Port;

use self::browser::Browser;
use self::flow::Failure;
use self::page::{snapshot_download_ids, DownloadItem};
use crate::port::parse_port;
use crate::release::ReleaseError;

const DEFAULT_TIMEOUT_SECONDS: u64 = 300;

/// Arguments of `release verify-download`.
#[derive(Debug, Clone, ClapArgs)]
pub(crate) struct Args {
    /// The browser's CDP port
    #[arg(default_value = "9229", value_parser = parse_port)]
    pub(crate) port: Port,
    /// Seconds to wait for the download to finish
    #[arg(default_value_t = DEFAULT_TIMEOUT_SECONDS)]
    pub(crate) timeout_seconds: u64,
}

/// The JSON line the verification prints.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Report {
    pub(crate) ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    filename: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    item: Option<Box<DownloadItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u128>,
}

impl Report {
    fn failure(failure: Failure, duration_ms: Option<u128>) -> Self {
        Self {
            ok: false,
            reason: Some(failure.reason),
            filename: None,
            bytes: None,
            item: failure.item,
            duration_ms,
        }
    }

    fn success(item: DownloadItem, duration_ms: u128) -> Self {
        Self {
            ok: true,
            reason: None,
            filename: Some(item.filename),
            bytes: item.bytes_received,
            item: None,
            duration_ms: Some(duration_ms),
        }
    }

    pub(crate) fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| String::from("{\"ok\":false}"))
    }
}

async fn cycle(
    browser: &Browser,
    start: Instant,
    timeout: Duration,
) -> Result<DownloadItem, Failure> {
    flow::require_targets(browser).await?;
    let before = snapshot_download_ids(browser).await;
    flow::wait_for_playable(browser).await?;
    flow::click_when_mounted(browser).await?;
    flow::poll_for_completion(browser, &before, start + timeout).await
}

/// Runs one verified download and returns what to print; a failure outside the cycle becomes a
/// report with the script-error reason.
pub(crate) async fn verify(args: &Args) -> Report {
    let browser = Browser::new(args.port);
    let start = Instant::now();
    let outcome = cycle(&browser, start, Duration::from_secs(args.timeout_seconds)).await;
    let elapsed = start.elapsed().as_millis();
    match outcome {
        Ok(item) => Report::success(item, elapsed),
        Err(failure) => {
            let duration = failure.is_timed.then_some(elapsed);
            Report::failure(failure, duration)
        }
    }
}

pub(super) async fn run(args: Args) -> Result<(), ReleaseError> {
    let report = verify(&args).await;
    println!("{}", report.to_json());
    if report.ok {
        return Ok(());
    }
    Err(ReleaseError::VerificationFailed(
        report
            .reason
            .unwrap_or_else(|| "download verification failed".to_owned()),
    ))
}
