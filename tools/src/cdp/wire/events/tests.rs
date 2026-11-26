//! Unit tests.

use serde_json::json;

use crate::cdp::wire::events::*;

#[test]
fn parses_and_renders_a_console_call() {
    let params = json!({"type": "log", "args": [{"value": "hi"}, {"description": "Object"}]});
    let event = Event::parse("Runtime.consoleAPICalled", params);
    let line = event.and_then(|parsed| render(&parsed, DUMP, None));
    assert_eq!(line.as_deref(), Some("[console:log] hi Object"));
}

#[test]
fn prefers_the_exception_description() {
    let params =
        json!({"exceptionDetails": {"text": "Uncaught", "exception": {"description": "Error: x"}}});
    let event = Event::parse("Runtime.exceptionThrown", params);
    let line = event.and_then(|parsed| render(&parsed, MONITOR, Some("SW")));
    assert_eq!(line.as_deref(), Some("[SW][EX] Error: x"));
}

#[test]
fn filters_unrelated_requests() {
    let event = Event::RequestSent {
        method: "GET".into(),
        url: "https://example.com".into(),
    };
    assert_eq!(render(&event, DUMP, None), None);
}

#[test]
fn unknown_methods_are_not_events() {
    assert_eq!(Event::parse("Page.frameNavigated", json!({})), None);
}

#[test]
fn an_execution_context_is_parsed_for_the_session_to_record() {
    let params = json!({"context": {"id": 7, "name": "Ext", "auxData": {"type": "isolated"}}});
    let Some(Event::ExecutionContextCreated(context)) =
        Event::parse("Runtime.executionContextCreated", params)
    else {
        panic!("not a context event");
    };
    assert_eq!((context.id, context.name.as_str()), (7, "Ext"));
    assert_eq!(context.aux.kind, "isolated");
    assert_eq!(
        render(&Event::ExecutionContextCreated(context), DUMP, None),
        None
    );
}
