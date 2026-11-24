//! The error of the CDP group.

use thiserror::Error;

/// Everything that can go wrong in a CDP command.
#[derive(Debug, Error)]
pub(crate) enum CdpError {
    /// The shared CDP library failed.
    #[error(transparent)]
    Library(#[from] ytdl_dev_hot::Error),
    /// A socket or file failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// A JSON document did not parse or did not match its type.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// A WebSocket handshake or frame failed.
    #[error("websocket: {0}")]
    WebSocket(#[from] Box<tokio_tungstenite::tungstenite::Error>),
    /// The page answered a command with an error, or sent something unexpected.
    #[error("protocol: {0}")]
    Protocol(String),
    /// An evaluated expression threw in the page.
    #[error("the page threw: {0}")]
    Exception(String),
    /// A wait ran out.
    #[error("timed out waiting for {0}")]
    Timeout(&'static str),
    /// The target closed the session.
    #[error("the CDP session closed")]
    Closed,
    /// The debug port's HTTP endpoint answered badly.
    #[error("http: {0}")]
    Http(String),
    /// A base64 payload did not decode.
    #[error("base64: {0}")]
    Base64(#[from] base64::DecodeError),
}

impl From<tokio_tungstenite::tungstenite::Error> for CdpError {
    fn from(error: tokio_tungstenite::tungstenite::Error) -> Self {
        Self::WebSocket(Box::new(error))
    }
}

/// The result type of the CDP group.
pub(crate) type Result<T> = std::result::Result<T, CdpError>;
