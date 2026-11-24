//! Stopping the browser instances that run on one profile directory, found by command line and
//! stopped by process id, never by program name.

use std::path::Path;

use crate::output::error::Result;
use crate::output::options::OsPlatform;
use crate::release::process::Invocation;

const LIST_WINDOWS_PROCESSES: &str = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }";

/// One running process: its id and full command line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct RunningProcess {
    pub(super) pid: u32,
    pub(super) command_line: String,
}

fn continues_a_path_segment(character: char) -> bool {
    character.is_alphanumeric() || matches!(character, '_' | '-' | '.')
}

fn mentions_profile(command_line: &str, profile: &str, is_case_insensitive: bool) -> bool {
    let (haystack, needle) = if is_case_insensitive {
        (command_line.to_lowercase(), profile.to_lowercase())
    } else {
        (command_line.to_owned(), profile.to_owned())
    };
    haystack.match_indices(&needle).any(|(start, found)| {
        haystack
            .get(start + found.len()..)
            .and_then(|rest| rest.chars().next())
            .is_none_or(|next| !continues_a_path_segment(next))
    })
}

/// The ids of the processes whose command line names `profile`, and of no other; none when the
/// profile path is empty or nothing matches.
pub(super) fn pids_on_profile(
    processes: &[RunningProcess],
    profile: &str,
    is_case_insensitive: bool,
    own_pid: u32,
) -> Vec<u32> {
    let profile = profile.trim_end_matches(['/', '\\']);
    if profile.is_empty() {
        return Vec::new();
    }
    processes
        .iter()
        .filter(|process| process.pid != own_pid)
        .filter(|process| mentions_profile(&process.command_line, profile, is_case_insensitive))
        .map(|process| process.pid)
        .collect()
}

fn parse_windows_listing(listing: &str) -> Vec<RunningProcess> {
    listing
        .lines()
        .filter_map(|line| {
            let (pid, command_line) = line.split_once('\t')?;
            Some(RunningProcess {
                pid: pid.trim().parse().ok()?,
                command_line: command_line.trim().to_owned(),
            })
        })
        .collect()
}

fn list_linux_processes() -> Vec<RunningProcess> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse().ok()?;
            let raw = std::fs::read(entry.path().join("cmdline")).ok()?;
            let command_line = String::from_utf8_lossy(&raw).replace('\0', " ");
            Some(RunningProcess { pid, command_line })
        })
        .collect()
}

async fn captured(program: &str, arguments: &[&str]) -> Result<String> {
    let output = Invocation::new(program).args(arguments).capture().await?;
    Ok(output.stdout)
}

async fn list_processes(platform: OsPlatform) -> Result<Vec<RunningProcess>> {
    match platform {
        OsPlatform::Linux => Ok(list_linux_processes()),
        OsPlatform::Windows => {
            let listing = captured(
                "powershell",
                &[
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    LIST_WINDOWS_PROCESSES,
                ],
            )
            .await?;
            Ok(parse_windows_listing(&listing))
        }
        OsPlatform::MacOs => Ok(Vec::new()),
    }
}

async fn terminate(platform: OsPlatform, pid: u32) -> Result<()> {
    let pid = pid.to_string();
    match platform {
        OsPlatform::Windows => captured("taskkill", &["/PID", &pid, "/F"]).await,
        _ => captured("kill", &["-TERM", &pid]).await,
    }
    .map(drop)
}

/// Terminates every process whose command line names `profile`.
pub(super) async fn stop_on_profile(platform: OsPlatform, profile: &Path) -> Result<()> {
    let processes = list_processes(platform).await?;
    let is_windows = platform == OsPlatform::Windows;
    let pids = pids_on_profile(
        &processes,
        &profile.display().to_string(),
        is_windows,
        std::process::id(),
    );
    for pid in pids {
        terminate(platform, pid).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn process(pid: u32, command_line: &str) -> RunningProcess {
        RunningProcess {
            pid,
            command_line: command_line.to_owned(),
        }
    }

    #[test]
    fn only_processes_naming_this_profile_match() {
        let processes = [
            process(1, "chrome --user-data-dir=/tmp/dev-profile --flag"),
            process(2, "chrome --user-data-dir=/home/me/.config/google-chrome"),
            process(3, "chrome --user-data-dir=/tmp/dev-profile2"),
            process(4, "chrome --user-data-dir=/tmp/dev-profile"),
        ];
        let pids = pids_on_profile(&processes, "/tmp/dev-profile", false, 4);
        assert_eq!(pids, vec![1]);
    }

    #[test]
    fn nothing_matches_an_unused_or_empty_profile() {
        let processes = [process(1, "chrome --user-data-dir=/other")];
        assert_eq!(
            pids_on_profile(&processes, "/tmp/none", false, 0),
            Vec::<u32>::new()
        );
        assert_eq!(pids_on_profile(&processes, "", false, 0), Vec::<u32>::new());
    }

    #[test]
    fn windows_paths_match_regardless_of_case() {
        let processes = [process(7, r#"chrome.exe --user-data-dir="C:\Dev\Profile""#)];
        assert_eq!(
            pids_on_profile(&processes, r"c:\dev\profile", true, 0),
            vec![7]
        );
        assert_eq!(
            pids_on_profile(&processes, r"c:\dev\profile", false, 0),
            Vec::<u32>::new()
        );
    }

    #[test]
    fn the_windows_listing_parses_pid_and_command_line() {
        let parsed = parse_windows_listing("12\tfirefox -profile X\nbad line\n13\tchrome\n");
        assert_eq!(
            parsed,
            vec![process(12, "firefox -profile X"), process(13, "chrome")]
        );
    }
}
