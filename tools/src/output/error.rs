//! The failures of the `output` group.

use std::path::Path;

use thiserror::Error;

/// Everything that can go wrong in an `output` command.
#[derive(Debug, Error)]
pub(crate) enum OutputError {
    /// A file or directory could not be read or written.
    #[error("io at {path}: {source}")]
    Io {
        /// The path the operation was on.
        path: String,
        /// The underlying failure.
        source: std::io::Error,
    },
    /// A JSON document did not parse or did not match its type.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// The shared sidecar library failed.
    #[error(transparent)]
    Library(#[from] ytdl_dev_hot::Error),
    /// A helper program could not start.
    #[error(transparent)]
    Process(#[from] crate::release::process::ProcessError),
    /// The input is well-formed but not usable.
    #[error("{0}")]
    Invalid(String),
}

impl OutputError {
    /// A `map_err` adapter that remembers which path the I/O failure was on.
    pub(crate) fn with_path(path: &Path) -> impl FnOnce(std::io::Error) -> Self {
        let path = path.display().to_string();
        move |source| Self::Io { path, source }
    }
}

/// The group's result type.
pub(crate) type Result<T> = std::result::Result<T, OutputError>;
