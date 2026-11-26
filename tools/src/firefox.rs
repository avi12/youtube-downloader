//! The `firefox` command group: Firefox RDP and Marionette helpers.

mod framed;
pub(crate) mod marionette;
pub(crate) mod rdp;

use std::time::Duration;

use clap::Subcommand;

/// The extension's gecko id, which is also its add-on id in Firefox's protocols.
pub(crate) const GECKO_ID: &str = "youtube-downloader@avi12.com";
/// The port Firefox's Marionette server listens on unless told otherwise.
pub(crate) const MARIONETTE_DEFAULT_PORT: u16 = 2828;

/// Everything that can go wrong in a Firefox command.
#[derive(Debug, thiserror::Error)]
pub(crate) enum FirefoxError {
    /// The shared RDP framing library failed.
    #[error(transparent)]
    Library(#[from] ytdl_dev_hot::Error),
    /// Reading or writing a socket or running a process failed.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    /// A JSON document did not parse or did not match its type.
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    /// A wait ran out.
    #[error("timeout waiting for {0}")]
    Timeout(String),
    /// A lookup, a protocol answer or a precondition failed in a way the caller must see.
    #[error("{0}")]
    Failed(String),
}

/// The group's result type.
pub(crate) type Result<T> = std::result::Result<T, FirefoxError>;

/// A pause between two protocol steps.
async fn pause(duration: Duration) {
    tokio::time::sleep(duration).await;
}

/// The commands of this group.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Drives one Firefox debugger server: addons, tabs, eval, nav, addon-eval, popup-measure
    RdpDrive(rdp::drive::DriveArgs),
    /// Lists the tabs, add-ons and processes of the running Firefox
    RdpList,
    /// Evaluates JavaScript in the first tab whose URL contains the given text
    RdpEval(rdp::eval::EvalArgs),
    /// Drives Firefox through Marionette (default port 2828)
    Marionette(marionette::command::MarionetteArgs),
    /// Prints the extension's `ytdl` console messages and errors for a while
    AddonConsole(rdp::console::ConsoleArgs),
}

/// Runs one command of this group.
pub(crate) async fn run(command: Command) -> crate::error::Result<()> {
    let outcome = match command {
        Command::RdpDrive(args) => rdp::drive::run(args).await,
        Command::RdpList => rdp::eval::list().await,
        Command::RdpEval(args) => rdp::eval::run(args).await,
        Command::Marionette(args) => marionette::command::run(args).await,
        Command::AddonConsole(args) => rdp::console::run(args).await,
    };
    Ok(outcome?)
}
