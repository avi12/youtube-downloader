//! What can go wrong while building the HMR modules.

use std::io;
use std::path::PathBuf;

use thiserror::Error;

/// A failure of the HMR build.
#[derive(Debug, Error)]
#[non_exhaustive]
pub(crate) enum HmrError {
    /// Reading or writing a file, or talking to the worker, failed.
    #[error("io: {0}")]
    Io(#[from] io::Error),
    /// A JSON document did not parse or did not match its type.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// A built-in pattern did not compile.
    #[error("pattern: {0}")]
    Pattern(#[from] regex::Error),
    /// A module did not parse.
    #[error("{0}")]
    Parse(String),
    /// The Node compile worker reported a failure.
    #[error("the HMR compile worker failed: {0}")]
    Worker(String),
    /// The Node compile worker ended before it reported a result.
    #[error("the HMR compile worker exited before reporting ({0})")]
    WorkerExited(String),
    /// A file the build needs is missing or unreadable.
    #[error("cannot read {path}: {source}")]
    Read {
        /// The file.
        path: PathBuf,
        /// Why.
        source: io::Error,
    },
    /// The background build task panicked or was cancelled.
    #[error("the HMR post-processing task did not finish: {0}")]
    Task(#[from] tokio::task::JoinError),
}

/// The result type of the HMR build.
pub(crate) type Result<T> = std::result::Result<T, HmrError>;
