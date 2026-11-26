//! The Firefox reload target. Port of `scripts/dev/browsers/firefox/target.ts`.
//!
//! A reloaded add-on's old content-script sandboxes are destroyed without running any cleanup, so
//! before the reload the live ISOLATED scripts are told to tear down (their WXT context
//! invalidates, unmounting their UI); afterwards the fresh copies are injected in place.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ytdl_dev_hot::types::Port;

use crate::dev::browsers::error::Result;
use crate::dev::browsers::scripts::{self, RUNTIME_RELOAD};
use crate::dev::browsers::target::{BoxFuture, ReloadTarget};
use crate::dev::browsers::targets::firefox::background::{
    evaluate_in_background, run_script_in_background, BackgroundAddress,
};
use crate::output::reload::{
    ExtensionReloadPlan, PageAction, PageRefreshPlan, RefreshedPage, TabUpdateResult,
};

const BACKGROUND_RETRY_ATTEMPTS: u32 = 5;
const BACKGROUND_RETRY_DELAY: Duration = Duration::from_secs(1);

/// What a Firefox target is built from.
#[derive(Debug, Clone)]
pub(crate) struct FirefoxTargetConfig {
    /// Firefox's remote debugging (RDP) port.
    pub(crate) rdp_port: Port,
    /// Firefox's Marionette port.
    pub(crate) marionette_port: Port,
    /// The gecko id: Firefox's `runtime.id` and RDP's add-on id.
    pub(crate) extension_id: String,
    /// The per-profile `moz-extension://` host.
    pub(crate) uuid: String,
}

/// What the hot sidecar needs to reach the add-on itself over RDP.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FirefoxConnection {
    debug_port: Port,
    marionette_port: Port,
    extension_id: String,
    extension_uuid: String,
}

/// A Firefox reached over RDP.
#[derive(Debug, Clone)]
pub(crate) struct FirefoxTarget {
    config: FirefoxTargetConfig,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewRefresh {
    name: String,
    is_closed: bool,
}

impl ViewRefresh {
    fn into_page(self) -> RefreshedPage {
        let action = if self.is_closed {
            PageAction::Closed
        } else {
            PageAction::Reloaded
        };
        RefreshedPage {
            name: self.name,
            action,
        }
    }
}

impl FirefoxTarget {
    /// A target on a running Firefox.
    pub(crate) const fn new(config: FirefoxTargetConfig) -> Self {
        Self { config }
    }

    /// The endpoints and identity of the add-on.
    pub(crate) fn connection(&self) -> FirefoxConnection {
        FirefoxConnection {
            debug_port: self.config.rdp_port,
            marionette_port: self.config.marionette_port,
            extension_id: self.config.extension_id.clone(),
            extension_uuid: self.config.uuid.clone(),
        }
    }

    fn address(&self) -> BackgroundAddress<'_> {
        BackgroundAddress {
            port: self.config.rdp_port,
            extension_id: &self.config.extension_id,
        }
    }

    /// Right after a reload the add-on (and its background) is still starting up.
    async fn evaluate_once_restarted(&self, source: &str) -> Result<Value> {
        let mut attempt = 1;
        loop {
            match evaluate_in_background(self.address(), source).await {
                Ok(value) => return Ok(value),
                Err(error) if attempt >= BACKGROUND_RETRY_ATTEMPTS => return Err(error),
                Err(_) => {
                    attempt += 1;
                    tokio::time::sleep(BACKGROUND_RETRY_DELAY).await;
                }
            }
        }
    }

    async fn reload_extension_now(&self, plan: &ExtensionReloadPlan) -> Result<TabUpdateResult> {
        evaluate_in_background(self.address(), &scripts::teardown(plan)?)
            .await
            .ok();
        run_script_in_background(self.address(), RUNTIME_RELOAD.trim())
            .await
            .ok();
        let value = self
            .evaluate_once_restarted(&scripts::tab_update(plan)?)
            .await?;
        Ok(serde_json::from_value(value)?)
    }

    async fn refresh_pages_now(&self, plan: &PageRefreshPlan) -> Result<Vec<RefreshedPage>> {
        let value = evaluate_in_background(self.address(), &scripts::page_refresh(plan)?).await?;
        let views: Vec<ViewRefresh> = serde_json::from_value(value)?;
        Ok(views.into_iter().map(ViewRefresh::into_page).collect())
    }
}

impl ReloadTarget for FirefoxTarget {
    fn reload_extension<'a>(
        &'a self,
        plan: &'a ExtensionReloadPlan,
    ) -> BoxFuture<'a, TabUpdateResult> {
        Box::pin(self.reload_extension_now(plan))
    }

    fn refresh_pages<'a>(&'a self, plan: &'a PageRefreshPlan) -> BoxFuture<'a, Vec<RefreshedPage>> {
        Box::pin(self.refresh_pages_now(plan))
    }

    fn evaluate_in_background<'a>(&'a self, expression: &'a str) -> BoxFuture<'a, Value> {
        Box::pin(evaluate_in_background(self.address(), expression))
    }

    fn run_script_in_background<'a>(&'a self, script: &'a str) -> BoxFuture<'a, ()> {
        Box::pin(run_script_in_background(self.address(), script))
    }
}

#[cfg(test)]
mod tests {
    use crate::dev::browsers::targets::firefox::target::*;

    const RDP_PORT: u16 = 6000;
    const MARIONETTE_PORT: u16 = 2828;

    #[test]
    fn view_refreshes_become_page_actions() {
        let closed: ViewRefresh =
            serde_json::from_str(r#"{"name":"offscreen","isClosed":true}"#).unwrap();
        assert_eq!(closed.into_page().action, PageAction::Closed);
        let reloaded: ViewRefresh =
            serde_json::from_str(r#"{"name":"popup","isClosed":false}"#).unwrap();
        assert_eq!(reloaded.into_page().action, PageAction::Reloaded);
    }

    #[test]
    fn the_connection_serializes_for_the_sidecar() {
        let target = FirefoxTarget::new(FirefoxTargetConfig {
            rdp_port: Port::new(RDP_PORT).unwrap(),
            marionette_port: Port::new(MARIONETTE_PORT).unwrap(),
            extension_id: "id@x".to_owned(),
            uuid: "u-u".to_owned(),
        });
        let json = serde_json::to_value(target.connection()).unwrap();
        assert_eq!(json["debugPort"], 6000);
        assert_eq!(json["extensionUuid"], "u-u");
    }
}
