//! The one Marionette call the launcher needs: installing the extension as a temporary add-on
//! (`Addon:Install`), what web-ext-run did through its own RDP client. The client is the one of the
//! `firefox` group; this adds the wait for Firefox to start listening.

use std::path::Path;
use std::time::Duration;

use tokio::time::sleep;

use crate::dev::launcher::error::{LauncherError, Result};
use crate::firefox::marionette::client::Marionette;

const CONNECT_ATTEMPTS: u32 = 60;
const CONNECT_RETRY_DELAY: Duration = Duration::from_millis(500);

async fn connect_when_listening(port: u16) -> Result<Marionette> {
    for _ in 0..CONNECT_ATTEMPTS {
        if let Ok(client) = Marionette::connect(port).await {
            return Ok(client);
        }
        sleep(CONNECT_RETRY_DELAY).await;
    }
    Err(LauncherError::Browser(format!(
        "Marionette did not answer on port {port}"
    )))
}

/// Installs `directory` as a temporary add-on of the Firefox listening on `port`.
pub(super) async fn install_temporary_addon(port: u16, directory: &Path) -> Result<()> {
    let mut client = connect_when_listening(port).await?;
    client
        .install_temporary_addon(&directory.display().to_string())
        .await
        .map_err(|error| LauncherError::Browser(format!("Addon:Install failed: {error}")))?;
    Ok(())
}
