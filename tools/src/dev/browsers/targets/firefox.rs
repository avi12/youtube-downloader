//! Firefox side of the dev server's hot reload, over RDP (the Firefox `DevTools` Remote Debugging
//! Protocol): Firefox's CDP endpoint lists no targets, so everything runs in the extension's own
//! background event page, where the tabs and scripting APIs live.

mod background;
mod target;

pub(crate) use self::target::{FirefoxTarget, FirefoxTargetConfig};
