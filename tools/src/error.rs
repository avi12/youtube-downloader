//! The one error type of the tooling binary.

use std::process::ExitCode;

use thiserror::Error;

use crate::cdp::wire::CdpError;
use crate::dev::{BrowserError, HmrError, LauncherError};
use crate::firefox::FirefoxError;
use crate::output::OutputError;
use crate::release::ReleaseError;

const EXIT_FAILURE: u8 = 1;
const EXIT_USAGE: u8 = 2;

/// Everything that can go wrong in a tool command.
#[derive(Debug, Error)]
#[non_exhaustive]
pub(crate) enum Error {
    /// The shared CDP, RDP or file-watching library failed.
    #[error(transparent)]
    Library(#[from] ytdl_dev_hot::Error),
    /// A `cdp` command failed.
    #[error(transparent)]
    Cdp(#[from] CdpError),
    /// A `firefox` command failed.
    #[error(transparent)]
    Firefox(#[from] FirefoxError),
    /// A `release` command failed.
    #[error(transparent)]
    Release(#[from] ReleaseError),
    /// An `output` command failed.
    #[error(transparent)]
    Output(#[from] OutputError),
    /// A `dev` browser target failed.
    #[error(transparent)]
    Browser(#[from] BrowserError),
    /// A `dev` HMR build failed.
    #[error(transparent)]
    Hmr(#[from] HmrError),
    /// The `dev` launcher failed.
    #[error(transparent)]
    Launcher(#[from] LauncherError),
    /// Reading or writing a file or pipe failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// A JSON document did not parse or did not match its type.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

impl Error {
    /// The process exit code: 2 when the command could not run, 1 when it ran and failed.
    pub(crate) fn exit_code(&self) -> ExitCode {
        ExitCode::from(if self.is_usage() {
            EXIT_USAGE
        } else {
            EXIT_FAILURE
        })
    }

    fn is_usage(&self) -> bool {
        match self {
            Self::Release(error) => error.is_script_error(),
            _ => false,
        }
    }
}

/// The tooling's result type.
pub(crate) type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dev::{HmrError, LauncherError};

    #[test]
    fn the_dev_errors_convert_and_exit_as_failures() {
        let launcher: Error = LauncherError::Invalid("x".to_owned()).into();
        let hmr: Error = HmrError::Parse("y".to_owned()).into();
        assert_eq!(launcher.exit_code(), ExitCode::from(EXIT_FAILURE));
        assert_eq!(hmr.exit_code(), ExitCode::from(EXIT_FAILURE));
    }
}
