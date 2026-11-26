//! A Marionette client: `[0, id, name, params]` commands answered by `[1, id, error, result]`,
//! over the same length-prefixed JSON framing as RDP.

use std::collections::HashMap;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::timeout;

use crate::firefox::framed::Framed;
use crate::firefox::{FirefoxError, Result};

pub(super) const DEFAULT_PORT: u16 = 2828;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const SCRIPT_TIMEOUT_MS: u64 = 30_000;
const REQUEST_MESSAGE: u8 = 0;
const YOUTUBE_PAGES: [&str; 2] = ["youtube.com/watch", "youtube.com/feed"];

/// The Marionette commands this client sends.
#[derive(Debug, Clone, Copy, Serialize)]
enum CommandName {
    #[serde(rename = "WebDriver:NewSession")]
    NewSession,
    #[serde(rename = "WebDriver:GetWindowHandles")]
    GetWindowHandles,
    #[serde(rename = "WebDriver:SwitchToWindow")]
    SwitchToWindow,
    #[serde(rename = "WebDriver:GetCurrentURL")]
    GetCurrentUrl,
    #[serde(rename = "WebDriver:ExecuteAsyncScript")]
    ExecuteAsyncScript,
    #[serde(rename = "WebDriver:NewWindow")]
    NewWindow,
    #[serde(rename = "WebDriver:Navigate")]
    Navigate,
    #[serde(rename = "WebDriver:PerformActions")]
    PerformActions,
    #[serde(rename = "WebDriver:FindElement")]
    FindElement,
    #[serde(rename = "WebDriver:ElementClick")]
    ElementClick,
    #[serde(rename = "Addon:Uninstall")]
    AddonUninstall,
    #[serde(rename = "Addon:Install")]
    AddonInstall,
}

/// Marionette answers either with the bare value or wrapped as `{"value": ...}`.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum MaybeWrapped<T> {
    Wrapped { value: T },
    Bare(T),
}

impl<T> MaybeWrapped<T> {
    fn into_inner(self) -> T {
        match self {
            Self::Wrapped { value } | Self::Bare(value) => value,
        }
    }
}

/// Whether a URL is a `YouTube` watch or feed page.
fn is_youtube_page(url: &str) -> bool {
    YOUTUBE_PAGES.iter().any(|page| url.contains(page))
}

/// The element id inside a `WebDriver` element reference (its key names the element, e.g.
/// `element-6066-11e4-a52e-4f735466cecf`).
fn element_id(reference: &HashMap<String, String>) -> Option<&str> {
    reference
        .iter()
        .find(|(key, _)| key.contains("element"))
        .map(|(_, id)| id.as_str())
}

/// Wraps a promise expression so `ExecuteAsyncScript` reports its settlement.
pub(super) fn wrap_promise_expression(expression: &str) -> String {
    format!(
        "{expression}\n.then(r => arguments[0](r), e => arguments[0]({{__error: String(e), stack: e?.stack}}));"
    )
}

/// One Marionette connection with an open session.
#[derive(Debug)]
pub(crate) struct Marionette {
    framed: Framed,
    next_id: u64,
}

impl Marionette {
    /// Connects and starts a `WebDriver` session.
    pub(crate) async fn connect(port: u16) -> Result<Self> {
        let mut client = Self {
            framed: Framed::connect(port).await?,
            next_id: 1,
        };
        let _: Value = client
            .send(CommandName::NewSession, json!({"capabilities": {}}))
            .await?;
        Ok(client)
    }

    async fn exchange<T: DeserializeOwned>(&mut self, id: u64) -> Result<T> {
        loop {
            let packet = self.framed.recv().await?;
            let Value::Array(items) = packet else {
                continue;
            };
            let [_, answered, error, result] = items.as_slice() else {
                continue;
            };
            let is_other_reply = answered.as_u64() != Some(id);
            if is_other_reply {
                continue;
            }
            if !error.is_null() {
                return Err(FirefoxError::Failed(format!("Marionette error: {error}")));
            }
            return Ok(T::deserialize(result)?);
        }
    }

    async fn send<T: DeserializeOwned>(
        &mut self,
        name: CommandName,
        parameters: Value,
    ) -> Result<T> {
        let id = self.next_id;
        self.next_id += 1;
        let command = json!([REQUEST_MESSAGE, id, name, parameters]);
        self.framed.send(&command).await?;
        timeout(COMMAND_TIMEOUT, self.exchange(id))
            .await
            .map_err(|_| FirefoxError::Timeout(format!("Marionette command {name:?}")))?
    }

    pub(super) async fn windows(&mut self) -> Result<Vec<String>> {
        let handles: MaybeWrapped<Vec<String>> =
            self.send(CommandName::GetWindowHandles, json!({})).await?;
        Ok(handles.into_inner())
    }

    pub(super) async fn switch_to(&mut self, handle: &str) -> Result<()> {
        let _: Value = self
            .send(
                CommandName::SwitchToWindow,
                json!({"name": handle, "handle": handle}),
            )
            .await?;
        Ok(())
    }

    pub(super) async fn current_url(&mut self) -> Result<String> {
        let url: MaybeWrapped<String> = self.send(CommandName::GetCurrentUrl, json!({})).await?;
        Ok(url.into_inner())
    }

    /// The first window showing a `YouTube` watch or feed page and its URL (the window stays current).
    pub(super) async fn find_youtube_tab(&mut self) -> Result<String> {
        for handle in self.windows().await? {
            self.switch_to(&handle).await?;
            let url = self.current_url().await?;
            if is_youtube_page(&url) {
                return Ok(url);
            }
        }
        Err(FirefoxError::Failed("No YouTube tab found".into()))
    }

    pub(super) async fn open_tab(&mut self) -> Result<()> {
        let _: Value = self
            .send(
                CommandName::NewWindow,
                json!({"type": "tab", "focus": true}),
            )
            .await?;
        Ok(())
    }

    pub(super) async fn navigate(&mut self, url: &str) -> Result<()> {
        let _: Value = self
            .send(CommandName::Navigate, json!({"url": url}))
            .await?;
        Ok(())
    }

    pub(super) async fn execute_async(&mut self, script: &str) -> Result<Value> {
        let parameters = json!({"script": script, "args": [], "scriptTimeout": SCRIPT_TIMEOUT_MS});
        self.send(CommandName::ExecuteAsyncScript, parameters).await
    }

    pub(super) async fn press_key(&mut self, key: &str) -> Result<()> {
        let actions = json!({"actions": [{
            "type": "key",
            "id": "kbd",
            "actions": [{"type": "keyDown", "value": key}, {"type": "keyUp", "value": key}]
        }]});
        let _: Value = self.send(CommandName::PerformActions, actions).await?;
        Ok(())
    }

    pub(super) async fn click(&mut self, selector: &str) -> Result<()> {
        let found: MaybeWrapped<HashMap<String, String>> = self
            .send(
                CommandName::FindElement,
                json!({"using": "css selector", "value": selector}),
            )
            .await?;
        let reference = found.into_inner();
        let id = element_id(&reference).ok_or_else(|| {
            FirefoxError::Failed(format!("Cannot resolve element id from {reference:?}"))
        })?;
        let _: Value = self
            .send(CommandName::ElementClick, json!({"id": id}))
            .await?;
        Ok(())
    }

    pub(super) async fn uninstall_addon(&mut self, id: &str) -> Result<()> {
        let _: Value = self
            .send(CommandName::AddonUninstall, json!({"id": id}))
            .await?;
        Ok(())
    }

    pub(crate) async fn install_temporary_addon(&mut self, path: &str) -> Result<Value> {
        self.send(
            CommandName::AddonInstall,
            json!({"path": path, "temporary": true}),
        )
        .await
    }
}

#[cfg(test)]
mod tests;
