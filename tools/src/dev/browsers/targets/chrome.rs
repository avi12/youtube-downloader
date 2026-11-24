//! Chrome side of the dev server's hot reload, over the dev browser's `--remote-debugging-port`.
//!
//! Reloading the extension orphans the content scripts already running in open tabs: Chrome keeps
//! their isolated world alive but cuts it off from the extension, and never re-injects declared
//! scripts into existing pages. So before re-injecting, each orphaned world is neutralized.

mod extensions_page;
mod target;
mod worlds;

pub(crate) use self::target::ChromeTarget;
