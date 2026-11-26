//! The loop's own timers and exits: build retries, re-injection, liveness and shutdown.

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde_json::json;
use tokio::time::{sleep, Instant};

use crate::orchestrator::tests::harness::start;
use crate::orchestrator::{InjectSchedule, HMR_INJECT_RETRY_DELAY, LIVENESS_POLL};

const POLL_PERIODS_TO_WAIT: u32 = 4;
const RETRY_SECONDS: u64 = 3;

#[tokio::test(start_paused = true)]
async fn a_transient_file_lock_retries_the_build() {
    let harness = start(&json!({}), |_| {}).await;
    harness
        .build_failures
        .lock()
        .unwrap()
        .push_back("EBUSY: resource busy".to_owned());
    harness.touch(&["src/lib/a.ts"]).await;
    harness.settle().await;
    assert_eq!(harness.log.count("build"), 2);
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn the_hmr_runtime_is_reinjected_on_the_steady_cadence() {
    let harness = start(&json!({"hmrReinjectIntervalMs": 3000}), |_| {}).await;
    harness.settle().await;
    assert!(harness.log.count("inject") >= 6);
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn a_dead_browser_ends_the_loop_after_three_failed_probes() {
    let harness = start(&json!({"isLivenessMonitored": true}), |_| {}).await;
    harness.is_browser_alive.store(false, Ordering::SeqCst);
    sleep(LIVENESS_POLL * POLL_PERIODS_TO_WAIT).await;
    assert!(harness.task.is_finished());
    harness.task.await.unwrap().unwrap();
}

#[tokio::test(start_paused = true)]
async fn shutdown_ends_the_loop_cleanly() {
    let harness = start(&json!({}), |_| {}).await;
    sleep(Duration::from_secs(1)).await;
    harness.stop().await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn injection_retries_then_settles_into_the_steady_cadence() {
    let start = Instant::now();
    let mut schedule = InjectSchedule::new(start, Some(Duration::from_secs(RETRY_SECONDS)));
    schedule.record(false, start);
    assert_eq!(schedule.next(), Some(start + HMR_INJECT_RETRY_DELAY));
    schedule.record(true, start);
    assert_eq!(schedule.next(), Some(start + Duration::from_secs(3)));
    let mut once = InjectSchedule::new(start, None);
    once.record(true, start);
    assert_eq!(once.next(), None);
}
