//! The messages the server pushes to every runtime, by their `type`.

/// The `type` of a pushed message; the runtime dispatches on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PushKind {
    /// The current HMR manifest, carried in a `manifest` field.
    Manifest,
    /// A reload is about to tear the runtime's world down.
    ReloadImminent,
    /// The liveness probe the runtime answers with a pong.
    Ping,
}

impl PushKind {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Manifest => "manifest",
            Self::ReloadImminent => "reload-imminent",
            Self::Ping => "ping",
        }
    }

    /// The message with no body beyond its `type`.
    pub(super) fn bare_payload(self) -> String {
        format!(r#"{{"type":"{}"}}"#, self.as_str())
    }

    /// The manifest message around the raw manifest file text.
    pub(super) fn manifest_payload(raw_manifest: &str) -> String {
        let kind = Self::Manifest.as_str();
        format!(r#"{{"type":"{kind}","manifest":{raw_manifest}}}"#)
    }
}

#[cfg(test)]
mod tests {
    use crate::hmr_server::push::*;

    #[test]
    fn payloads_keep_the_runtime_wire_shape() {
        assert_eq!(PushKind::Ping.bare_payload(), r#"{"type":"ping"}"#);
        assert_eq!(
            PushKind::ReloadImminent.bare_payload(),
            r#"{"type":"reload-imminent"}"#
        );
        assert_eq!(
            PushKind::manifest_payload("{}"),
            r#"{"type":"manifest","manifest":{}}"#
        );
    }
}
