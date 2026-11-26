//! Launching the dev browser without web-ext-run: Chrome for Testing with `--load-extension`, or
//! Firefox with a debugger server and a temporary add-on.

mod cft;
mod chrome;
mod firefox;
mod marionette;

use std::path::Path;
use std::sync::Arc;

use tokio::process::Child;
use ytdl_dev_hot::types::Port;

use crate::dev::browsers::{ChromeTarget, FirefoxTarget, FirefoxTargetConfig, ReloadTarget};
use crate::dev::launcher::error::Result;
use crate::output::options::{BuildBrowser, DevOptions, HostEnvironment};

/// What launching needs to know.
#[derive(Debug, Clone, Copy)]
pub(super) struct BrowserLaunch<'a> {
    pub(super) options: &'a DevOptions,
    pub(super) host: &'a HostEnvironment,
    pub(super) output_dir: &'a Path,
}

/// The ids Firefox is reached by once it runs.
#[derive(Debug, Clone)]
pub(super) struct FirefoxIdentity {
    pub(super) rdp_port: u16,
    pub(super) extension_id: String,
    pub(super) uuid: String,
}

/// A running dev browser: the process this launcher started, and how to reach it.
#[derive(Debug)]
pub(super) struct RunningBrowser {
    pub(super) child: Child,
    pub(super) firefox: Option<FirefoxIdentity>,
}

impl RunningBrowser {
    /// The port the hot loop talks to: CDP for Chrome, RDP for Firefox.
    pub(super) fn debug_port(&self, options: &DevOptions) -> u16 {
        self.firefox
            .as_ref()
            .map_or(options.cdp_port, |identity| identity.rdp_port)
    }

    /// The reload target of this browser.
    pub(super) fn reload_target(&self, options: &DevOptions) -> Result<Arc<dyn ReloadTarget>> {
        let Some(identity) = &self.firefox else {
            return Ok(Arc::new(ChromeTarget::new(Port::new(options.cdp_port)?)));
        };
        Ok(Arc::new(FirefoxTarget::new(FirefoxTargetConfig {
            rdp_port: Port::new(identity.rdp_port)?,
            marionette_port: Port::new(options.marionette_port)?,
            extension_id: identity.extension_id.clone(),
            uuid: identity.uuid.clone(),
        })))
    }
}

/// Starts the browser the options name, with the extension from the output directory loaded.
pub(super) async fn launch(launch: BrowserLaunch<'_>) -> Result<RunningBrowser> {
    match launch.options.browser() {
        BuildBrowser::Chrome => Ok(RunningBrowser {
            child: chrome::launch(launch).await?,
            firefox: None,
        }),
        BuildBrowser::Firefox => {
            let (child, identity) = firefox::launch(launch).await?;
            Ok(RunningBrowser {
                child,
                firefox: Some(identity),
            })
        }
    }
}
