//! The error of the browser targets.

use thiserror::Error;

use crate::cdp::wire::CdpError;
use crate::firefox::FirefoxError;
use crate::output::OutputError;

/// Everything that can go wrong while driving a browser target.
#[derive(Debug, Error)]
pub(crate) enum BrowserError {
    /// The shared CDP or RDP library failed.
    #[error(transparent)]
    Library(#[from] ytdl_dev_hot::Error),
    /// The shared CDP session failed.
    #[error(transparent)]
    Cdp(#[from] CdpError),
    /// Describing the outcome failed.
    #[error(transparent)]
    Firefox(#[from] FirefoxError),
    #[error(transparent)]
    Output(#[from] OutputError),
    /// A socket or file failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// A JSON document did not parse or did not match its type.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// A browser peer sent something unexpected.
    #[error("protocol: {0}")]
    Protocol(String),
    /// An evaluated expression threw in the browser.
    #[error("the browser threw: {0}")]
    Exception(String),
    /// A wait ran out.
    #[error("timed out waiting for {0}")]
    Timeout(&'static str),
}

/// The result type of the browser targets.
pub(crate) type Result<T> = std::result::Result<T, BrowserError>;
