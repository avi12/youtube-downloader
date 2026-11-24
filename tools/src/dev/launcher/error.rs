//! What can go wrong while launching and running the dev server.

use thiserror::Error;

use crate::dev::browsers::BrowserError;
use crate::dev::hmr::HmrError;
use crate::output::OutputError;
use crate::release::process::ProcessError;

/// A failure of the launcher.
#[derive(Debug, Error)]
pub(crate) enum LauncherError {
    /// A program could not start or failed.
    #[error(transparent)]
    Process(#[from] ProcessError),
    /// A fact the launcher needs is missing or malformed.
    #[error("{0}")]
    Invalid(String),
    /// The browser did not do what the launcher asked.
    #[error("browser: {0}")]
    Browser(String),
    /// A build output step failed.
    #[error(transparent)]
    Output(#[from] OutputError),
    /// A browser target failed.
    #[error(transparent)]
    Target(#[from] BrowserError),
    /// The HMR build failed.
    #[error(transparent)]
    Hmr(#[from] HmrError),
    /// The hot loop library failed.
    #[error(transparent)]
    Library(#[from] ytdl_dev_hot::Error),
    /// A file or socket failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// A JSON document did not parse.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
}

/// The launcher's result type.
pub(crate) type Result<T> = std::result::Result<T, LauncherError>;
