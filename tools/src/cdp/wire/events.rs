//! The CDP events the log-watching commands print, and how each style renders them.

use serde::Deserialize;
use serde_json::Value;

const NET_URL_NEEDLES: [&str; 3] = ["googlevideo", "youtubei", "chrome-extension"];
const NET_URL_MAX_CHARS: usize = 200;

#[derive(Debug, Deserialize)]
enum EventMethod {
    #[serde(rename = "Runtime.consoleAPICalled")]
    Console,
    #[serde(rename = "Log.entryAdded")]
    Log,
    #[serde(rename = "Runtime.exceptionThrown")]
    Exception,
    #[serde(rename = "Network.requestWillBeSent")]
    RequestSent,
    #[serde(rename = "Network.responseReceived")]
    ResponseReceived,
    #[serde(rename = "Network.loadingFailed")]
    LoadingFailed,
    #[serde(rename = "Runtime.executionContextCreated")]
    ExecutionContextCreated,
}

/// One JavaScript context of a page.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub(crate) struct ExecutionContext {
    /// The id `Runtime.evaluate` takes as `contextId`.
    pub(crate) id: u64,
    /// The context's name (an extension's isolated world carries its extension name).
    #[serde(default)]
    pub(crate) name: String,
    /// What kind of context it is.
    #[serde(default, rename = "auxData")]
    pub(crate) aux: ContextAux,
}

/// What kind of context it is.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
pub(crate) struct ContextAux {
    /// `default`, `isolated` or `worker`.
    #[serde(default, rename = "type")]
    pub(crate) kind: String,
}

#[derive(Debug, Deserialize)]
struct ContextCreated {
    context: ExecutionContext,
}

#[derive(Debug, Deserialize)]
struct RemoteArg {
    value: Option<Value>,
    description: Option<String>,
    preview: Option<Value>,
}

impl RemoteArg {
    fn text(&self) -> String {
        if let Some(value) = &self.value {
            return value
                .as_str()
                .map_or_else(|| value.to_string(), str::to_owned);
        }
        if let Some(description) = &self.description {
            return description.clone();
        }
        self.preview
            .as_ref()
            .map_or_else(String::new, Value::to_string)
    }
}

#[derive(Debug, Deserialize)]
struct ConsoleParams {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    args: Vec<RemoteArg>,
}

#[derive(Debug, Deserialize)]
struct LogParams {
    entry: LogEntry,
}

#[derive(Debug, Deserialize)]
struct LogEntry {
    level: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExceptionParams {
    exception_details: ExceptionDetails,
}

#[derive(Debug, Deserialize)]
pub(super) struct ExceptionDetails {
    text: Option<String>,
    exception: Option<ExceptionObject>,
}

#[derive(Debug, Deserialize)]
struct ExceptionObject {
    description: Option<String>,
}

impl ExceptionDetails {
    /// The page's own description when it has one, else the short text.
    pub(super) fn message(self) -> String {
        self.exception
            .and_then(|exception| exception.description)
            .or(self.text)
            .unwrap_or_else(|| "?".to_owned())
    }
}

#[derive(Debug, Deserialize)]
struct RequestParams {
    request: RequestInfo,
}

#[derive(Debug, Deserialize)]
struct RequestInfo {
    method: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct ResponseParams {
    response: ResponseInfo,
}

#[derive(Debug, Deserialize)]
struct ResponseInfo {
    status: u16,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FailedParams {
    error_text: String,
    #[serde(rename = "type", default)]
    kind: String,
}

/// One event of a target worth printing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Event {
    /// A `console.*` call.
    Console { kind: String, text: String },
    /// A browser log entry.
    Log { level: String, text: String },
    /// An uncaught exception.
    Exception(String),
    /// A network request left the page.
    RequestSent { method: String, url: String },
    /// A network response arrived.
    ResponseReceived { status: u16, url: String },
    /// A network request failed.
    LoadingFailed { error: String, kind: String },
    /// A JavaScript context appeared; a session records these instead of handing them out.
    ExecutionContextCreated(ExecutionContext),
}

impl Event {
    /// Reads an event frame; unknown methods and unparseable params are not events.
    pub(super) fn parse(method: &str, parameters: Value) -> Option<Self> {
        let method: EventMethod = serde_json::from_value(Value::String(method.to_owned())).ok()?;
        match method {
            EventMethod::Console => {
                let parsed: ConsoleParams = serde_json::from_value(parameters).ok()?;
                let text = parsed
                    .args
                    .iter()
                    .map(RemoteArg::text)
                    .collect::<Vec<_>>()
                    .join(" ");
                Some(Self::Console {
                    kind: parsed.kind,
                    text,
                })
            }
            EventMethod::Log => {
                let LogParams { entry } = serde_json::from_value(parameters).ok()?;
                Some(Self::Log {
                    level: entry.level,
                    text: entry.text,
                })
            }
            EventMethod::Exception => {
                let parsed: ExceptionParams = serde_json::from_value(parameters).ok()?;
                Some(Self::Exception(parsed.exception_details.message()))
            }
            EventMethod::RequestSent => {
                let RequestParams { request } = serde_json::from_value(parameters).ok()?;
                Some(Self::RequestSent {
                    method: request.method,
                    url: request.url,
                })
            }
            EventMethod::ResponseReceived => {
                let ResponseParams { response } = serde_json::from_value(parameters).ok()?;
                Some(Self::ResponseReceived {
                    status: response.status,
                    url: response.url,
                })
            }
            EventMethod::LoadingFailed => {
                let parsed: FailedParams = serde_json::from_value(parameters).ok()?;
                Some(Self::LoadingFailed {
                    error: parsed.error_text,
                    kind: parsed.kind,
                })
            }
            EventMethod::ExecutionContextCreated => {
                let ContextCreated { context } = serde_json::from_value(parameters).ok()?;
                Some(Self::ExecutionContextCreated(context))
            }
        }
    }
}

/// How one command words its lines.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Style {
    console_prefix: &'static str,
    log_prefix: &'static str,
    exception_tag: &'static str,
}

/// The wording of `dump monitor` and `dump capture`.
pub(crate) const MONITOR: Style = Style {
    console_prefix: "",
    log_prefix: "",
    exception_tag: "EX",
};

/// The wording of `dump sw-logs`.
pub(crate) const SW_LOGS: Style = Style {
    console_prefix: "",
    log_prefix: "",
    exception_tag: "exception",
};

/// The wording of `dump page`.
pub(crate) const DUMP: Style = Style {
    console_prefix: "console:",
    log_prefix: "log:",
    exception_tag: "exception",
};

fn is_watched_url(url: &str) -> bool {
    NET_URL_NEEDLES.iter().any(|needle| url.contains(needle))
}

fn clip(url: &str) -> String {
    url.chars().take(NET_URL_MAX_CHARS).collect()
}

/// The printed line of an event, or none when the event is filtered out.
pub(crate) fn render(event: &Event, style: Style, label: Option<&str>) -> Option<String> {
    let tag = label.map_or_else(String::new, |name| format!("[{name}]"));
    match event {
        Event::Console { kind, text } => {
            Some(format!("{tag}[{}{kind}] {text}", style.console_prefix))
        }
        Event::Log { level, text } => Some(format!("{tag}[{}{level}] {text}", style.log_prefix)),
        Event::Exception(text) => Some(format!("{tag}[{}] {text}", style.exception_tag)),
        Event::RequestSent { method, url } if is_watched_url(url) => {
            Some(format!("[net:req] {method} {}", clip(url)))
        }
        Event::ResponseReceived { status, url } if is_watched_url(url) => {
            Some(format!("[net:res] {status} {}", clip(url)))
        }
        Event::LoadingFailed { error, kind } => Some(format!("[net:fail] {error} | type={kind}")),
        Event::RequestSent { .. }
        | Event::ResponseReceived { .. }
        | Event::ExecutionContextCreated(_) => None,
    }
}

#[cfg(test)]
mod tests;
