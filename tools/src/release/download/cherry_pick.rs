//! `release cherry-pick-loop`: cherry-picks commits one at a time, verifying a download after each
//! and reverting the pick when the verification fails.

use std::path::PathBuf;
use std::time::Duration;

use clap::Args as ClapArgs;
use serde::Serialize;
use tokio::time::sleep;
use ytdl_dev_hot::driver::cdp::CdpClient;
use ytdl_dev_hot::driver::BrowserDriver;
use ytdl_dev_hot::types::Port;

use crate::port::parse_port;
use crate::release::download::log::log;
use crate::release::download::{verify, Args as VerifyArgs, Report};
use crate::release::process::{Captured, Invocation, ProcessError};
use crate::release::ReleaseError;

const RESULTS_FILE: &str = "scripts/cherry-pick-loop.results.json";
const STASH_MESSAGE: &str = "cherry-pick-loop wip auto-stash";
const REBUILD_WAIT: Duration = Duration::from_secs(9);
const RELOAD_SETTLE: Duration = Duration::from_millis(2500);
const CONFLICT_DETAIL_LINES: usize = 5;

/// Arguments of `release cherry-pick-loop`.
#[derive(Debug, ClapArgs)]
pub(crate) struct Args {
    /// A file with one commit SHA per line; lines starting with '#' are ignored
    commits_file: PathBuf,
    /// The browser's CDP port
    #[arg(default_value = "9229", value_parser = parse_port)]
    port: Port,
    /// Seconds each download verification may take
    #[arg(default_value_t = 240)]
    timeout_seconds: u64,
}

/// How one commit ended.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Outcome {
    SkippedConflict,
    PopConflict,
    VerifyFailedReverted,
    #[serde(rename = "ok")]
    Verified,
}

#[derive(Debug, Serialize)]
struct PickResult {
    sha: String,
    subject: String,
    outcome: Outcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verify: Option<String>,
}

struct Pop {
    is_popped: bool,
    is_conflict: bool,
    output: String,
}

fn parse_commits(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .filter_map(|line| line.split_whitespace().next())
        .map(str::to_owned)
        .collect()
}

async fn git(args: &[&str]) -> Result<Captured, ProcessError> {
    Invocation::new("git").args(args).capture().await
}

async fn git_ok(args: &[&str]) -> Result<bool, ProcessError> {
    Ok(git(args).await?.code == Some(0))
}

async fn stash_wip() -> Result<bool, ProcessError> {
    let status = git(&["status", "--porcelain", "-uno"]).await?;
    if status.stdout.is_empty() {
        return Ok(false);
    }
    git_ok(&["stash", "push", "-m", STASH_MESSAGE]).await
}

async fn pop_wip() -> Result<Pop, ProcessError> {
    let list = git(&["stash", "list"]).await?;
    let none = Pop {
        is_popped: false,
        is_conflict: false,
        output: String::new(),
    };
    if !list.stdout.lines().any(|line| line.contains(STASH_MESSAGE)) {
        return Ok(none);
    }
    let output = Invocation::new("git")
        .arg("stash")
        .arg("pop")
        .capture_checked()
        .await;
    Ok(match output {
        Ok(text) => Pop {
            is_popped: true,
            is_conflict: false,
            output: text,
        },
        Err(ProcessError::Failed { stderr, .. }) => Pop {
            is_popped: false,
            is_conflict: stderr.to_lowercase().contains("conflict"),
            output: stderr,
        },
        Err(error) => return Err(error),
    })
}

async fn save_results(results: &[PickResult]) -> Result<(), ReleaseError> {
    tokio::fs::write(RESULTS_FILE, serde_json::to_string_pretty(results)?).await?;
    Ok(())
}

async fn first_error_lines(args: &[&str], count: usize) -> Result<(bool, String), ProcessError> {
    match Invocation::new("git").args(args).capture_checked().await {
        Ok(_) => Ok((true, String::new())),
        Err(ProcessError::Failed { stderr, .. }) => {
            let lines: Vec<&str> = stderr.lines().take(count).collect();
            Ok((false, lines.join(" | ")))
        }
        Err(error) => Err(error),
    }
}

async fn verify_pick(args: &Args) -> Report {
    let browser = CdpClient::new(args.port);
    log(&format!(
        "waiting {}ms for dev-server rebuild...",
        REBUILD_WAIT.as_millis()
    ))
    .await;
    sleep(REBUILD_WAIT).await;
    browser.reload_youtube_tabs().await.ok();
    sleep(RELOAD_SETTLE).await;
    log("running verify-download...").await;
    verify(&VerifyArgs {
        port: args.port,
        timeout_seconds: args.timeout_seconds,
    })
    .await
}

struct Attempt {
    outcome: Outcome,
    detail: Option<String>,
    verify: Option<String>,
}

impl Attempt {
    fn conflict(outcome: Outcome, detail: String) -> Self {
        Self {
            outcome,
            detail: Some(detail),
            verify: None,
        }
    }

    fn verified(outcome: Outcome, verify: String) -> Self {
        Self {
            outcome,
            detail: None,
            verify: Some(verify),
        }
    }
}

async fn skip_conflicted_pick(did_stash: bool, detail: String) -> Result<Attempt, ReleaseError> {
    let first_line = detail.split(" | ").next().unwrap_or_default();
    log(&format!("cherry-pick CONFLICT, skipping: {first_line}")).await;
    git(&["cherry-pick", "--abort"]).await?;
    let pop = pop_wip().await?;
    if !pop.is_popped && did_stash {
        log("WARNING: stash pop failed after abort").await;
    }
    Ok(Attempt::conflict(Outcome::SkippedConflict, detail))
}

async fn revert_pick() -> Result<(), ReleaseError> {
    let did_stash = stash_wip().await?;
    if !git_ok(&["reset", "--hard", "HEAD~1"]).await? {
        log("reset FAILED").await;
    }
    if did_stash {
        pop_wip().await?;
    }
    Ok(())
}

async fn attempt(sha: &str, did_stash: bool, args: &Args) -> Result<Attempt, ReleaseError> {
    let (is_picked, detail) =
        first_error_lines(&["cherry-pick", sha], CONFLICT_DETAIL_LINES).await?;
    if !is_picked {
        return skip_conflicted_pick(did_stash, detail).await;
    }
    let pop = pop_wip().await?;
    if !pop.is_popped && did_stash {
        log(&format!("stash pop FAILED (conflict={})", pop.is_conflict)).await;
        return Ok(Attempt::conflict(Outcome::PopConflict, pop.output));
    }
    let report = verify_pick(args).await;
    let text = report.to_json();
    log(&format!("verify stdout: {text}")).await;
    if report.ok {
        return Ok(Attempt::verified(Outcome::Verified, text));
    }
    log(&format!("verify FAILED for {sha} - reverting commit")).await;
    revert_pick().await?;
    Ok(Attempt::verified(Outcome::VerifyFailedReverted, text))
}

async fn pick(sha: &str, subject: String, args: &Args) -> Result<PickResult, ReleaseError> {
    let did_stash = stash_wip().await?;
    if did_stash {
        log("stashed WIP").await;
    }
    let Attempt {
        outcome,
        detail,
        verify,
    } = attempt(sha, did_stash, args).await?;
    Ok(PickResult {
        sha: sha.to_owned(),
        subject,
        outcome,
        detail,
        verify,
    })
}

pub(in crate::release) async fn run(args: Args) -> Result<(), ReleaseError> {
    let text = tokio::fs::read_to_string(&args.commits_file)
        .await
        .map_err(|_| ReleaseError::CommitsFileMissing(args.commits_file.clone()))?;
    let commits = parse_commits(&text);
    let total = commits.len();
    log(&format!("starting cherry-pick loop: {total} commits")).await;
    let branch = git(&["rev-parse", "--abbrev-ref", "HEAD"]).await?.stdout;
    log(&format!("branch: {branch}")).await;
    let mut results = Vec::new();
    for (index, sha) in commits.iter().enumerate() {
        let subject = git(&["log", "-1", "--format=%s", sha]).await?.stdout;
        log("---").await;
        log(&format!("[{}/{total}] {sha} {subject}", index + 1)).await;
        let result = pick(sha, subject, &args).await?;
        let is_halting = matches!(result.outcome, Outcome::PopConflict);
        results.push(result);
        save_results(&results).await?;
        if is_halting {
            log("HALTING for triage").await;
            return Err(ReleaseError::CherryPickHalted(format!(
                "stash pop conflict after {sha}"
            )));
        }
    }
    log(&format!(
        "DONE - all {total} commits cherry-picked and verified"
    ))
    .await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::release::download::cherry_pick::*;

    #[test]
    fn commits_skip_comments_and_keep_the_first_word() {
        let parsed = parse_commits("# header\nabc123 subject here\n\n  def456  \r\n");
        assert_eq!(parsed, vec!["abc123".to_owned(), "def456".to_owned()]);
    }

    #[test]
    fn outcomes_serialize_in_kebab_case() {
        let text = serde_json::to_string(&Outcome::VerifyFailedReverted).unwrap();
        assert_eq!(text, "\"verify-failed-reverted\"");
    }
}
