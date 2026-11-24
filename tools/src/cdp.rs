//! The `cdp` command group: probes, inspections, checks, log dumps and screenshots over the
//! Chrome ``DevTools`` Protocol. Every command connects only to the debug port it is given.

mod dump;
mod inspect;
mod page;
mod screenshot;
mod script;
pub(crate) mod wire;

use clap::Subcommand;

use self::wire::PortArg;
use crate::error::Result;

/// The commands of this group.
#[derive(Debug, Subcommand)]
pub(crate) enum Command {
    /// Evaluate an expression in a target and print the raw result
    Eval(page::EvalArgs),
    /// Reload the first watch page
    Reload(PortArg),
    /// Dump what the pages and the service worker currently hold
    #[command(subcommand)]
    Inspect(inspect::Inspect),
    /// Pass or fail checks of the extension
    #[command(subcommand)]
    Check(inspect::Check),
    /// Stream a target's console, log, exception and network lines
    #[command(subcommand)]
    Dump(dump::Dump),
    /// Isolate which link of the click-to-download chain breaks
    #[command(subcommand)]
    Bisect(page::Bisect),
    /// Capture the popup or any page as a PNG
    #[command(subcommand)]
    Screenshot(screenshot::Screenshot),
}

/// Runs one command of this group.
pub(crate) async fn run(command: Command) -> Result<()> {
    let outcome = match command {
        Command::Eval(args) => page::eval(args).await,
        Command::Reload(port) => page::reload(port).await,
        Command::Inspect(inspect) => inspect::run_inspect(inspect).await,
        Command::Check(check) => inspect::run_check(check).await,
        Command::Dump(dump) => dump::run(dump).await,
        Command::Bisect(bisect) => page::run_bisect(bisect).await,
        Command::Screenshot(screenshot) => screenshot::run(screenshot).await,
    };
    Ok(outcome?)
}
