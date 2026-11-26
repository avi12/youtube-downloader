//! The targets `/json/list` reports, and which of them count as `YouTube` tabs.

use std::fmt;

use serde::Deserialize;

/// The host every `YouTube` tab's URL carries.
const YOUTUBE_HOST: &str = "youtube.com";

/// The id of a CDP target, as `/json/list` reports it.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Deserialize)]
#[serde(transparent)]
pub struct TargetId(pub String);

impl fmt::Display for TargetId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// What a target is; only pages are ever reloaded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum TargetKind {
    /// A tab or an extension page.
    Page,
    /// A service worker, such as the extension's background.
    ServiceWorker,
    /// Any other kind (iframes, workers, browser targets).
    #[serde(other)]
    Other,
}

/// One entry of `/json/list`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdpTarget {
    /// The target id.
    pub id: TargetId,
    /// What the target is.
    #[serde(rename = "type")]
    pub kind: TargetKind,
    /// The target URL.
    #[serde(default)]
    pub url: String,
    /// Where to open a session; missing when another client holds the target.
    #[serde(default)]
    pub web_socket_debugger_url: Option<String>,
}

impl CdpTarget {
    /// Where to open a session, when no other client holds the target.
    pub fn debugger_url(&self) -> Option<&str> {
        self.web_socket_debugger_url.as_deref()
    }

    /// Whether a session can be opened and the URL contains `needle`.
    pub(super) fn is_open_at(&self, needle: &str) -> bool {
        self.debugger_url().is_some() && self.url.contains(needle)
    }
}

/// Whether a target is a `YouTube` page tab with a debugger URL. Port of `findYouTubeTabTargets`.
///
/// ```
/// use ytdl_dev_hot::driver::cdp::{is_youtube_tab, CdpTarget, TargetId, TargetKind};
///
/// let tab = CdpTarget {
///     id: TargetId("1".into()),
///     kind: TargetKind::Page,
///     url: "https://www.youtube.com/watch?v=x".into(),
///     web_socket_debugger_url: Some("ws://127.0.0.1:9222/devtools/page/1".into()),
/// };
/// assert!(is_youtube_tab(&tab));
/// ```
pub fn is_youtube_tab(target: &CdpTarget) -> bool {
    target.kind == TargetKind::Page && target.is_open_at(YOUTUBE_HOST)
}

#[cfg(test)]
mod tests {
    use crate::driver::cdp::target::*;
    use crate::error::Result;

    fn target(kind: TargetKind, url: &str, websocket: Option<&str>) -> CdpTarget {
        CdpTarget {
            id: TargetId("t".into()),
            kind,
            url: url.into(),
            web_socket_debugger_url: websocket.map(Into::into),
        }
    }

    #[test]
    fn only_page_targets_on_youtube_with_a_debugger_url_are_youtube_tabs() {
        let socket = Some("ws://x");
        let youtube = "https://www.youtube.com/";
        assert!(is_youtube_tab(&target(TargetKind::Page, youtube, socket)));
        assert!(!is_youtube_tab(&target(
            TargetKind::Page,
            "https://example.com/",
            socket
        )));
        assert!(!is_youtube_tab(&target(
            TargetKind::ServiceWorker,
            youtube,
            socket
        )));
        assert!(!is_youtube_tab(&target(TargetKind::Page, youtube, None)));
    }

    #[test]
    fn targets_parse_with_missing_optional_fields_and_unknown_kinds() -> Result<()> {
        let list: Vec<CdpTarget> =
            serde_json::from_str(r#"[{"id":"1","type":"page"},{"id":"2","type":"iframe"}]"#)?;
        assert_eq!(list.first().map(|item| item.url.as_str()), Some(""));
        assert_eq!(
            list.iter().map(|item| item.kind).collect::<Vec<_>>(),
            [TargetKind::Page, TargetKind::Other]
        );
        Ok(())
    }
}
