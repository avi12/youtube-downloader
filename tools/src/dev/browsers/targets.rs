//! The two browser families a reload can target: Chrome over CDP and Firefox over RDP.

mod chrome;
mod firefox;

pub(crate) use self::chrome::ChromeTarget;
pub(crate) use self::firefox::{FirefoxTarget, FirefoxTargetConfig};
