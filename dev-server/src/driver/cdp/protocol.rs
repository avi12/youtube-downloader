//! The typed shape of CDP messages: the commands a session sends and the frames it reads back.
//! Chrome sends more than is read here, so unknown fields are ignored.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::Result;

/// The CDP commands sent by the sidecar and the tools.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum Method {
    /// Starts console and exception events.
    #[serde(rename = "Runtime.enable")]
    RuntimeEnable,
    /// Evaluates an expression.
    #[serde(rename = "Runtime.evaluate")]
    RuntimeEvaluate,
    /// Calls a function with an object as `this`.
    #[serde(rename = "Runtime.callFunctionOn")]
    RuntimeCallFunctionOn,
    /// Starts browser log events.
    #[serde(rename = "Log.enable")]
    LogEnable,
    /// Starts network events.
    #[serde(rename = "Network.enable")]
    NetworkEnable,
    /// Starts page events.
    #[serde(rename = "Page.enable")]
    PageEnable,
    /// Reloads the page.
    #[serde(rename = "Page.reload")]
    PageReload,
    /// Lists the frames of the page.
    #[serde(rename = "Page.getFrameTree")]
    PageGetFrameTree,
    /// Navigates one frame.
    #[serde(rename = "Page.navigate")]
    PageNavigate,
    /// Captures the page as an image.
    #[serde(rename = "Page.captureScreenshot")]
    PageCaptureScreenshot,
    /// Overrides the viewport.
    #[serde(rename = "Emulation.setDeviceMetricsOverride")]
    EmulationSetDeviceMetricsOverride,
    /// Opens a new tab or window.
    #[serde(rename = "Target.createTarget")]
    TargetCreateTarget,
    /// Lists the listeners of an object.
    #[serde(rename = "DOMDebugger.getEventListeners")]
    DomDebuggerGetEventListeners,
}

/// The parameters of a command that takes none.
#[derive(Debug, Clone, Copy, Default, Serialize)]
pub struct NoParameters {}

/// The parameters of `Runtime.evaluate`.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvaluateParameters<'request> {
    expression: &'request str,
    #[serde(skip_serializing_if = "Option::is_none")]
    await_promise: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    context_id: Option<u64>,
    return_by_value: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    object_group: Option<&'request str>,
}

impl<'request> EvaluateParameters<'request> {
    /// Evaluates in the page's own context, awaiting a promise and returning its value.
    pub const fn awaited(expression: &'request str) -> Self {
        Self {
            expression,
            await_promise: Some(true),
            context_id: None,
            return_by_value: true,
            object_group: None,
        }
    }

    /// Evaluates in one context, returning the value, or a remote object kept in `group`.
    pub const fn in_context(
        expression: &'request str,
        context_id: u64,
        group: Option<&'request str>,
    ) -> Self {
        Self {
            expression,
            await_promise: None,
            context_id: Some(context_id),
            return_by_value: group.is_none(),
            object_group: group,
        }
    }
}

#[derive(Serialize)]
struct Command<'request, P> {
    id: u64,
    method: Method,
    #[serde(rename = "params")]
    parameters: &'request P,
}

/// The message text of one command.
pub fn encode_command<P: Serialize>(id: u64, method: Method, parameters: &P) -> Result<String> {
    Ok(serde_json::to_string(&Command {
        id,
        method,
        parameters,
    })?)
}

/// One message from a target: the reply to a command (`id`) or an event (`method`). Results,
/// event parameters and errors depend on the command, so each reader parses its own.
#[derive(Debug, Deserialize)]
pub struct Incoming {
    /// The command this answers.
    pub id: Option<u64>,
    /// The event's name.
    pub method: Option<String>,
    /// The event's parameters.
    #[serde(default, rename = "params")]
    pub parameters: Value,
    /// The command's result.
    pub result: Option<Value>,
    /// Why the command failed.
    pub error: Option<Value>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::driver::cdp::protocol::*;

    #[test]
    fn commands_keep_their_wire_shape() -> Result<()> {
        let cases = [
            (
                encode_command(1, Method::PageEnable, &NoParameters {})?,
                json!({"id":1,"method":"Page.enable","params":{}}),
            ),
            (
                encode_command(
                    2,
                    Method::RuntimeEvaluate,
                    &EvaluateParameters::awaited("1"),
                )?,
                json!({"id":2,"method":"Runtime.evaluate",
                    "params":{"expression":"1","awaitPromise":true,"returnByValue":true}}),
            ),
            (
                encode_command(
                    3,
                    Method::RuntimeEvaluate,
                    &EvaluateParameters::in_context("d", 7, Some("g")),
                )?,
                json!({"id":3,"method":"Runtime.evaluate","params":{"expression":"d",
                    "contextId":7,"returnByValue":false,"objectGroup":"g"}}),
            ),
        ];
        for (sent, expected) in cases {
            assert_eq!(serde_json::from_str::<Value>(&sent)?, expected);
        }
        Ok(())
    }

    #[test]
    fn replies_and_events_parse_with_unknown_fields() -> Result<()> {
        let reply: Incoming = serde_json::from_str(r#"{"id":4,"result":{},"sessionId":"s"}"#)?;
        assert_eq!((reply.id, reply.method), (Some(4), None));
        let event: Incoming =
            serde_json::from_str(r#"{"method":"Log.entryAdded","params":{"entry":{}}}"#)?;
        assert_eq!(event.method.as_deref(), Some("Log.entryAdded"));
        Ok(())
    }
}
