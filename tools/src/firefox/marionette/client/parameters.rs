//! The parameters of each Marionette command, in `WebDriver`'s wire names.

use serde::Serialize;

const SCRIPT_TIMEOUT_MS: u64 = 30_000;
const KEYBOARD_ID: &str = "kbd";

/// The parameters of a command that takes none.
#[derive(Debug, Serialize)]
pub(super) struct NoParameters {}

/// `WebDriver:NewSession`, asking for no particular capabilities.
#[derive(Debug, Default, Serialize)]
pub(super) struct NewSession {
    capabilities: NoCapabilities,
}

#[derive(Debug, Default, Serialize)]
struct NoCapabilities {}

/// `WebDriver:SwitchToWindow`; Firefox versions differ in which of the two names they read.
#[derive(Debug, Serialize)]
pub(super) struct SwitchToWindow<'handle> {
    name: &'handle str,
    handle: &'handle str,
}

impl<'handle> SwitchToWindow<'handle> {
    pub(super) const fn new(handle: &'handle str) -> Self {
        Self {
            name: handle,
            handle,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum WindowType {
    Tab,
}

/// `WebDriver:NewWindow`.
#[derive(Debug, Serialize)]
pub(super) struct NewWindow {
    #[serde(rename = "type")]
    kind: WindowType,
    focus: bool,
}

impl NewWindow {
    pub(super) const FOCUSED_TAB: Self = Self {
        kind: WindowType::Tab,
        focus: true,
    };
}

/// `WebDriver:Navigate`.
#[derive(Debug, Serialize)]
pub(super) struct Navigate<'url> {
    pub(super) url: &'url str,
}

/// `WebDriver:ExecuteAsyncScript` without arguments.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExecuteScript<'script> {
    script: &'script str,
    args: [(); 0],
    script_timeout: u64,
}

impl<'script> ExecuteScript<'script> {
    pub(super) const fn new(script: &'script str) -> Self {
        Self {
            script,
            args: [],
            script_timeout: SCRIPT_TIMEOUT_MS,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum KeyActionKind {
    KeyDown,
    KeyUp,
}

#[derive(Debug, Serialize)]
struct KeyAction<'key> {
    #[serde(rename = "type")]
    kind: KeyActionKind,
    value: &'key str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
enum InputSource {
    Key,
}

#[derive(Debug, Serialize)]
struct ActionSequence<'key> {
    #[serde(rename = "type")]
    source: InputSource,
    id: &'static str,
    actions: [KeyAction<'key>; 2],
}

/// `WebDriver:PerformActions`.
#[derive(Debug, Serialize)]
pub(super) struct PerformActions<'key> {
    actions: [ActionSequence<'key>; 1],
}

impl<'key> PerformActions<'key> {
    /// One key pressed and released.
    pub(super) const fn key_press(key: &'key str) -> Self {
        let pressed = KeyAction {
            kind: KeyActionKind::KeyDown,
            value: key,
        };
        let released = KeyAction {
            kind: KeyActionKind::KeyUp,
            value: key,
        };
        Self {
            actions: [ActionSequence {
                source: InputSource::Key,
                id: KEYBOARD_ID,
                actions: [pressed, released],
            }],
        }
    }
}

#[derive(Debug, Serialize)]
enum LocatorStrategy {
    #[serde(rename = "css selector")]
    CssSelector,
}

/// `WebDriver:FindElement`.
#[derive(Debug, Serialize)]
pub(super) struct FindElement<'selector> {
    using: LocatorStrategy,
    value: &'selector str,
}

impl<'selector> FindElement<'selector> {
    pub(super) const fn css(selector: &'selector str) -> Self {
        Self {
            using: LocatorStrategy::CssSelector,
            value: selector,
        }
    }
}

/// A command naming one thing by id: `WebDriver:ElementClick` and `Addon:Uninstall`.
#[derive(Debug, Serialize)]
pub(super) struct ById<'id> {
    pub(super) id: &'id str,
}

/// `Addon:Install`.
#[derive(Debug, Serialize)]
pub(super) struct InstallAddon<'path> {
    path: &'path str,
    temporary: bool,
}

impl<'path> InstallAddon<'path> {
    /// An add-on that is gone after a restart.
    pub(super) const fn temporary(path: &'path str) -> Self {
        Self {
            path,
            temporary: true,
        }
    }
}
