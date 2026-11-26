//! The one place programs are spawned: arguments are always an array, never a shell string, and
//! failures carry the command line and the captured stderr.

use std::ffi::{OsStr, OsString};
use std::path::PathBuf;
use std::process::Stdio;

use thiserror::Error;
use tokio::process::{Child, Command};

const BUN_PROGRAM: &str = "bun";
/// The extensions Windows runs directly, in the order `CreateProcess` would prefer them.
const WINDOWS_EXECUTABLE_EXTENSIONS: [&str; 4] = ["exe", "cmd", "bat", "com"];

/// The first file of `program` found on `PATH` (with a Windows executable extension when the name
/// has none), else the bare name. Bun is an `.exe` when installed on its own and a `.cmd`
/// shim when installed through npm, and a spawned process does not search `PATHEXT` for it.
fn resolve_program(program: &str, search_path: &OsStr) -> OsString {
    let candidates: Vec<String> = if cfg!(windows) && !program.contains('.') {
        WINDOWS_EXECUTABLE_EXTENSIONS
            .iter()
            .map(|extension| format!("{program}.{extension}"))
            .collect()
    } else {
        vec![program.to_owned()]
    };
    std::env::split_paths(search_path)
        .flat_map(|directory| candidates.iter().map(move |name| directory.join(name)))
        .find(|candidate| candidate.is_file())
        .map_or_else(|| OsString::from(program), PathBuf::into_os_string)
}

/// A spawned program failed to start or exited unsuccessfully.
#[derive(Debug, Error)]
pub(crate) enum ProcessError {
    /// The program could not be started.
    #[error("could not start `{command_line}`: {source}")]
    Spawn {
        /// The program and its arguments.
        command_line: String,
        /// Why it did not start.
        #[source]
        source: std::io::Error,
    },
    /// The program ran and exited with a failure.
    #[error("`{command_line}` failed (exit code {}): {stderr}", .code.map_or_else(|| "none".to_owned(), |code| code.to_string()))]
    Failed {
        /// The program and its arguments.
        command_line: String,
        /// The exit code, absent when a signal ended it.
        code: Option<i32>,
        /// The trimmed standard error, empty when the program inherited it.
        stderr: String,
    },
}

/// The output of a finished program.
#[derive(Debug)]
pub(crate) struct Captured {
    /// Trimmed standard output.
    pub(crate) stdout: String,
    /// The exit code, absent when a signal ended the program.
    pub(crate) code: Option<i32>,
}

/// A program and its arguments, ready to run.
#[derive(Debug, Clone)]
pub(crate) struct Invocation {
    program: OsString,
    args: Vec<OsString>,
    directory: Option<PathBuf>,
    environment: Vec<(OsString, OsString)>,
}

impl Invocation {
    /// A program with no arguments.
    pub(crate) fn new(program: impl Into<OsString>) -> Self {
        Self {
            program: program.into(),
            args: Vec::new(),
            directory: None,
            environment: Vec::new(),
        }
    }

    /// `bun`, resolved on `PATH` (an `.exe` or a `.cmd` shim on Windows).
    pub(crate) fn bun() -> Self {
        let search_path = std::env::var_os("PATH").unwrap_or_default();
        Self::new(resolve_program(BUN_PROGRAM, &search_path))
    }

    /// Appends one argument.
    pub(crate) fn arg(mut self, arg: impl AsRef<OsStr>) -> Self {
        self.args.push(arg.as_ref().to_owned());
        self
    }

    /// Appends several arguments.
    pub(crate) fn args<I, S>(mut self, args: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<OsStr>,
    {
        self.args
            .extend(args.into_iter().map(|arg| arg.as_ref().to_owned()));
        self
    }

    /// Runs the program in `directory`.
    pub(crate) fn in_directory(mut self, directory: impl Into<PathBuf>) -> Self {
        self.directory = Some(directory.into());
        self
    }

    /// Sets one environment variable for the program.
    pub(crate) fn env(mut self, name: impl Into<OsString>, value: impl Into<OsString>) -> Self {
        self.environment.push((name.into(), value.into()));
        self
    }

    fn command_line(&self) -> String {
        std::iter::once(&self.program)
            .chain(&self.args)
            .map(|part| part.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .envs(self.environment.iter().cloned());
        if let Some(directory) = &self.directory {
            command.current_dir(directory);
        }
        command
    }

    fn spawn_error(&self, source: std::io::Error) -> ProcessError {
        ProcessError::Spawn {
            command_line: self.command_line(),
            source,
        }
    }

    /// Runs to completion with stdout captured and stderr discarded; a non-zero exit is not an
    /// error, only a failure to start is.
    pub(crate) async fn capture(&self) -> Result<Captured, ProcessError> {
        let output = self
            .command()
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .await
            .map_err(|source| self.spawn_error(source))?;
        Ok(Captured {
            stdout: String::from_utf8_lossy(&output.stdout).trim().to_owned(),
            code: output.status.code(),
        })
    }

    /// Runs to completion capturing stdout and stderr; a non-zero exit carries the stderr.
    pub(crate) async fn capture_checked(&self) -> Result<String, ProcessError> {
        let output = self
            .command()
            .stdin(Stdio::null())
            .output()
            .await
            .map_err(|source| self.spawn_error(source))?;
        if !output.status.success() {
            return Err(ProcessError::Failed {
                command_line: self.command_line(),
                code: output.status.code(),
                stderr: String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    /// Runs to completion sharing this process's stdio; returns the exit code.
    pub(crate) async fn run_inherited_code(&self) -> Result<Option<i32>, ProcessError> {
        let status = self
            .command()
            .status()
            .await
            .map_err(|source| self.spawn_error(source))?;
        Ok(status.code())
    }

    /// Runs to completion sharing this process's stdio; a non-zero exit is an error.
    pub(crate) async fn run_inherited(&self) -> Result<(), ProcessError> {
        let code = self.run_inherited_code().await?;
        if code == Some(0) {
            return Ok(());
        }
        Err(ProcessError::Failed {
            command_line: self.command_line(),
            code,
            stderr: String::new(),
        })
    }

    /// Starts the program and keeps it running; dropping the handle kills it.
    pub(crate) fn spawn_kill_on_drop(&self) -> Result<Child, ProcessError> {
        self.command()
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|source| self.spawn_error(source))
    }

    /// Starts the program and leaves it running on its own, with no stdio.
    pub(crate) fn spawn_detached(&self) -> Result<(), ProcessError> {
        self.command()
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map(drop)
            .map_err(|source| self.spawn_error(source))
    }
}

#[cfg(test)]
mod tests {
    use crate::release::process::*;

    #[test]
    fn command_line_joins_program_and_arguments() {
        let invocation = Invocation::new("git")
            .arg("status")
            .args(["-uno", "--short"]);
        assert_eq!(invocation.command_line(), "git status -uno --short");
    }

    #[test]
    fn a_program_is_found_on_the_search_path_with_its_extension() {
        let directory = std::env::temp_dir().join("ytdl-resolve-program-test");
        let extension = if cfg!(windows) { "exe" } else { "" };
        let file_name = if extension.is_empty() {
            "ytdl-probe".to_owned()
        } else {
            format!("ytdl-probe.{extension}")
        };
        let created = std::fs::create_dir_all(&directory)
            .and_then(|()| std::fs::write(directory.join(&file_name), b""));
        assert!(created.is_ok());

        let resolved = resolve_program("ytdl-probe", directory.as_os_str());
        assert_eq!(resolved, directory.join(file_name).into_os_string());
        assert_eq!(
            resolve_program("ytdl-absent", directory.as_os_str()),
            OsString::from("ytdl-absent")
        );
    }

    #[tokio::test]
    async fn a_missing_program_is_a_spawn_error() {
        let outcome = Invocation::new("ytdl-no-such-program").capture().await;
        assert!(matches!(outcome, Err(ProcessError::Spawn { .. })));
    }
}

#[cfg(test)]
mod environment_tests {
    use crate::release::process::*;

    #[test]
    fn an_environment_variable_reaches_the_command() {
        let invocation = Invocation::new("program").env("YTDL_SEAM", "1");
        let command = invocation.command();
        let found = command
            .as_std()
            .get_envs()
            .any(|(name, value)| name == "YTDL_SEAM" && value == Some(OsStr::new("1")));
        assert!(found);
    }
}
