//! The bridge protocol through the public API only, as the TypeScript side will see it.

use ytdl_dev_hot::bridge::protocol::{
    decode_line, encode_line, HostRequest, InboundMessage, Notification, OutboundMessage,
    RequestEnvelope, SidecarConfig,
};
use ytdl_dev_hot::types::{BrowserKind, RequestId};
use ytdl_dev_hot::Result;

const CONFIG_LINE: &str = r#"{"projectRoot":"C:/p/extension","outputDir":"C:/p/extension/.output/chrome-mv3-development","browser":"chromium","debugPort":9222,"hmrPort":9260,"watchPaths":["src","wxt.config.ts"],"envFiles":[".env"],"installMarker":"../node_modules/.modules.yaml","installedLockfile":"C:/p/node_modules/.pnpm/lock.yaml","skippedEntrypoints":[],"htmlEntrypoints":[{"name":"popup","watchPath":"src/entrypoints/popup"}],"debounceMs":800,"pollIntervalMs":500}"#;

#[test]
fn the_config_line_from_the_launcher_parses() -> Result<()> {
    let config: SidecarConfig = decode_line(CONFIG_LINE)?;
    assert_eq!(config.browser, BrowserKind::Chromium);
    assert_eq!(config.hmr_port.get(), 9260);
    assert_eq!(config.html_entrypoints.len(), 1);
    assert_eq!(config.extension_id, None);
    Ok(())
}

#[test]
fn a_zero_port_is_rejected() {
    let line = CONFIG_LINE.replace("9222", "0");
    assert!(decode_line::<SidecarConfig>(&line).is_err());
}

#[test]
fn requests_and_notifications_use_the_documented_shapes() -> Result<()> {
    let line = encode_line(&OutboundMessage::Request(RequestEnvelope {
        id: RequestId(1),
        request: HostRequest::RebuildHmr,
    }))?;
    assert_eq!(line, "{\"id\":1,\"method\":\"rebuildHmr\"}\n");
    let inbound: InboundMessage = decode_line("{\"notify\":\"shutdown\"}\n")?;
    assert_eq!(
        inbound,
        InboundMessage::Notification(Notification::Shutdown)
    );
    Ok(())
}
