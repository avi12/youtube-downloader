use serde_json::json;

use super::*;

fn request_line(request: HostRequest) -> Result<String> {
    encode_line(&OutboundMessage::Request(RequestEnvelope {
        id: RequestId(7),
        request,
    }))
}

#[test]
fn unit_request_has_no_params() -> Result<()> {
    assert_eq!(
        request_line(HostRequest::BuildExtension)?,
        "{\"id\":7,\"method\":\"buildExtension\"}\n"
    );
    Ok(())
}

#[test]
fn reload_request_round_trips() -> Result<()> {
    let request = HostRequest::ReloadExtension(ReloadExtensionParams {
        changed: ChangedOutputs {
            is_background_changed: true,
            ..ChangedOutputs::default()
        },
        started_at_ms: 12,
    });
    let decoded: OutboundMessage = decode_line(&request_line(request.clone())?)?;
    assert_eq!(
        decoded,
        OutboundMessage::Request(RequestEnvelope {
            id: RequestId(7),
            request
        })
    );
    Ok(())
}

#[test]
fn log_line_is_distinguished_from_a_request() -> Result<()> {
    let decoded: OutboundMessage = decode_line("{\"log\":\"hello\"}")?;
    assert_eq!(
        decoded,
        OutboundMessage::Log(LogLine {
            log: "hello".into()
        })
    );
    Ok(())
}

#[test]
fn inbound_tells_responses_from_notifications() -> Result<()> {
    let shutdown: InboundMessage = decode_line("{\"notify\":\"shutdown\"}")?;
    assert_eq!(
        shutdown,
        InboundMessage::Notification(Notification::Shutdown)
    );
    let response: InboundMessage = decode_line("{\"id\":3,\"result\":true}")?;
    assert_eq!(
        response,
        InboundMessage::Response(Response {
            id: RequestId(3),
            result: Some(json!(true)),
            error: None
        })
    );
    Ok(())
}

#[test]
fn error_response_becomes_a_host_error() -> Result<()> {
    let response: Response = decode_line("{\"id\":1,\"error\":\"build failed\"}")?;
    assert!(
        matches!(response.into_result(), Err(Error::Host { message }) if message == "build failed")
    );
    Ok(())
}

#[test]
fn null_result_is_a_void_success() -> Result<()> {
    let response: Response = decode_line("{\"id\":1,\"result\":null}")?;
    assert_eq!(response.into_result()?, Value::Null);
    Ok(())
}

#[test]
fn our_own_messages_reject_unknown_fields() {
    let known = r#"{"hmrSourceFiles":["a.ts"]}"#;
    assert!(decode_line::<RebuildHmrResult>(known).is_ok());
    let misspelled = r#"{"hmrSourceFiles":[],"hmrSourceFile":[]}"#;
    assert!(decode_line::<RebuildHmrResult>(misspelled).is_err());
}
