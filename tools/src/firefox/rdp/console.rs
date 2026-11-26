//! `addon-console [duration_ms]`: prints the extension's `ytdl` console messages and errors.

use std::time::Duration;

use clap::Args;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::time::Instant;
use ytdl_dev_hot::driver::rdp::message::{
    PacketKind, RequestKind, ResourceType, WatchTargetsParams,
};

use super::client::{find_rdp_port, Rdp};
use crate::firefox::Result;

const DEFAULT_DURATION_MS: u64 = 30_000;
const MARKER: &str = "ytdl";
const REPLY_TIMEOUT: Duration = Duration::from_secs(5);

/// Arguments of `addon-console`.
#[derive(Debug, Args)]
pub(crate) struct ConsoleArgs {
    /// How long to watch, in milliseconds
    #[arg(default_value_t = DEFAULT_DURATION_MS)]
    duration_ms: u64,
}

/// The resources the console watcher is asked for.
const WATCHED_RESOURCES: [ResourceType; 2] =
    [ResourceType::ConsoleMessage, ResourceType::ErrorMessage];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchResourcesParams {
    resource_types: [ResourceType; 2],
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Resource {
    #[serde(rename = "resourceType")]
    kind: ResourceType,
    /// What the page logged: arbitrary values.
    arguments: Vec<Value>,
    level: Option<String>,
    page_error: Option<PageError>,
    message: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct PageError {
    error_message: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct ResourcesPacket {
    #[serde(rename = "type")]
    kind: Option<PacketKind>,
    array: Vec<(String, Vec<Resource>)>,
}

/// An argument the way JavaScript's `String`/`JSON.stringify` mix prints it.
fn display_argument(argument: &Value) -> String {
    match argument {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// The line to print for a resource, when it mentions the extension.
fn format_resource(resource: &Resource) -> Option<String> {
    match resource.kind {
        ResourceType::ConsoleMessage => {
            let arguments: Vec<String> = resource.arguments.iter().map(display_argument).collect();
            let joined = arguments.join(" ");
            let level = resource.level.as_deref().unwrap_or("undefined");
            joined
                .contains(MARKER)
                .then(|| format!("[{level}] {joined}"))
        }
        ResourceType::ErrorMessage => {
            let page_error = resource
                .page_error
                .as_ref()
                .and_then(|error| error.error_message.as_deref());
            let text = page_error.or(resource.message.as_deref())?;
            text.contains(MARKER).then(|| format!("[error] {text}"))
        }
        ResourceType::Other => None,
    }
}

pub(in crate::firefox) async fn run(args: ConsoleArgs) -> Result<()> {
    let port = find_rdp_port().await?;
    let mut rdp = Rdp::connect(port, REPLY_TIMEOUT).await?;
    let watcher = rdp.addon_watcher().await?;
    rdp.request(
        &watcher,
        RequestKind::WatchTargets,
        &WatchTargetsParams::FRAMES,
    )
    .await?;
    let resources = WatchResourcesParams {
        resource_types: WATCHED_RESOURCES,
    };
    rdp.request(&watcher, RequestKind::WatchResources, &resources)
        .await?;

    let duration = Duration::from_millis(args.duration_ms);
    println!("Watching for {} ms", args.duration_ms);
    let deadline = Instant::now() + duration;
    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        let Some(message) = rdp.next_message(remaining).await? else {
            break;
        };
        let Ok(packet) = message.parse::<ResourcesPacket>() else {
            continue;
        };
        if packet.kind != Some(PacketKind::ResourcesAvailable) {
            continue;
        }
        let lines = packet
            .array
            .iter()
            .flat_map(|(_, resources)| resources)
            .filter_map(format_resource);
        for line in lines {
            println!("{line}");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn parse(value: Value) -> Resource {
        serde_json::from_value(value).unwrap_or_default()
    }

    #[test]
    fn a_console_message_with_the_marker_prints_its_level_and_arguments() {
        let resource = parse(
            json!({"resourceType": "console-message", "level": "log", "arguments": ["ytdl up", {"a": 1}, 3]}),
        );
        assert_eq!(
            format_resource(&resource),
            Some("[log] ytdl up {\"a\":1} 3".to_owned())
        );
    }

    #[test]
    fn messages_without_the_marker_are_dropped() {
        let resource = parse(
            json!({"resourceType": "console-message", "level": "log", "arguments": ["other"]}),
        );
        assert_eq!(format_resource(&resource), None);
    }

    #[test]
    fn an_error_prefers_the_page_error_text() {
        let resource = parse(
            json!({"resourceType": "error-message", "pageError": {"errorMessage": "ytdl boom"}, "message": "ytdl other"}),
        );
        assert_eq!(
            format_resource(&resource),
            Some("[error] ytdl boom".to_owned())
        );
    }

    #[test]
    fn unknown_resource_types_are_ignored() {
        let resource = parse(json!({"resourceType": "network-event", "message": "ytdl"}));
        assert_eq!(format_resource(&resource), None);
    }
}
