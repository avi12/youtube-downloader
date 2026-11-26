//! Finding the console of the extension's background page: through the addon's watcher, waking a
//! suspended event page first when it does not announce itself.

use std::time::Duration;

use serde_json::json;
use tokio::net::TcpStream;

use crate::driver::rdp::connection::{Connection, Evaluation};
use crate::driver::rdp::message::{ActorId, PacketKind, RequestKind, WatchedTargetType};
use crate::driver::rdp::RdpClient;
use crate::error::{Error, Result};

/// The id of the browser's parent process, whose privileged console can wake an event page.
const PARENT_PROCESS_ID: u32 = 0;
const MOZ_EXTENSION_SCHEME: &str = "moz-extension://";

type TcpConnection = Connection<TcpStream>;

impl RdpClient {
    /// The background page's console actor; `None` when the extension or its background cannot
    /// be found, even after a wake.
    pub(super) async fn find_background_console(
        &self,
        connection: &mut TcpConnection,
    ) -> Result<Option<ActorId>> {
        let limit = self.timings.reply;
        let addons = connection
            .request(&ActorId::root(), RequestKind::ListAddons, json!({}), limit)
            .await?;
        let Some(addon_actor) = addons
            .addons
            .into_iter()
            .find(|addon| addon.id.as_deref() == Some(self.extension_id.as_str()))
            .and_then(|addon| addon.actor)
        else {
            return Ok(None);
        };
        let watcher_options = json!({"isServerTargetSwitchingEnabled": true});
        let watcher = connection
            .request(
                &addon_actor,
                RequestKind::GetWatcher,
                watcher_options,
                limit,
            )
            .await?;
        let Some(watcher_actor) = watcher.actor else {
            return Ok(None);
        };
        let frames = json!({"targetType": WatchedTargetType::Frame});
        connection
            .send(&watcher_actor, RequestKind::WatchTargets, frames, limit)
            .await?;
        let awake = self
            .wait_background_frame(connection, self.timings.awake_background)
            .await?;
        if awake.is_some() {
            return Ok(awake);
        }
        if let Err(error) = self.wake_background(connection).await {
            tracing::debug!(%error, "rdp background wake refused");
        }
        self.wait_background_frame(connection, self.timings.woken_background)
            .await
    }

    async fn wait_background_frame(
        &self,
        connection: &mut TcpConnection,
        limit: Duration,
    ) -> Result<Option<ActorId>> {
        let prefix = format!("{MOZ_EXTENSION_SCHEME}{}", self.extension_uuid);
        let waited = connection
            .wait_for(limit, "rdp background frame", |packet| {
                let url = packet
                    .target
                    .as_ref()
                    .and_then(|target| target.url.as_deref());
                packet.is_kind(PacketKind::TargetAvailable)
                    && url.is_some_and(|text| text.starts_with(&prefix))
            })
            .await;
        match waited {
            Ok(packet) => Ok(packet.target.and_then(|target| target.console_actor)),
            Err(Error::Timeout(_)) => Ok(None),
            Err(error) => Err(error),
        }
    }

    /// Wakes a suspended event page through the privileged main-process console, never touching a tab.
    async fn wake_background(&self, connection: &mut TcpConnection) -> Result<()> {
        let limit = self.timings.reply;
        let process = connection
            .request(
                &ActorId::root(),
                RequestKind::GetProcess,
                json!({"id": PARENT_PROCESS_ID}),
                limit,
            )
            .await?;
        let Some(descriptor) = process.process_descriptor.and_then(|found| found.actor) else {
            return Ok(());
        };
        let target = connection
            .request(&descriptor, RequestKind::GetTarget, json!({}), limit)
            .await?;
        let Some(console) = target
            .process
            .or(target.frame)
            .and_then(|found| found.console_actor)
        else {
            return Ok(());
        };
        let code = format!(
            "WebExtensionPolicy.getByID({})?.extension.wakeupBackground()",
            json!(self.extension_id)
        );
        connection
            .evaluate(&console, &code, Evaluation::Immediate, limit)
            .await?;
        Ok(())
    }
}
