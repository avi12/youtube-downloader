use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use ytdl_dev_hot::driver::rdp::encode_packet;

use serde_json::json;

use crate::firefox::marionette::client::*;

#[test]
fn watch_and_feed_pages_are_youtube_pages() {
    assert!(is_youtube_page("https://www.youtube.com/watch?v=abc"));
    assert!(is_youtube_page(
        "https://www.youtube.com/feed/subscriptions"
    ));
    assert!(!is_youtube_page("https://www.youtube.com/"));
}

#[test]
fn handles_come_bare_or_wrapped() -> Result<()> {
    let bare: MaybeWrapped<Vec<String>> = serde_json::from_value(json!(["a", "b"]))?;
    let wrapped: MaybeWrapped<Vec<String>> = serde_json::from_value(json!({"value": ["a"]}))?;
    assert_eq!(bare.into_inner(), ["a", "b"]);
    assert_eq!(wrapped.into_inner(), ["a"]);
    Ok(())
}

#[test]
fn the_element_id_is_found_under_any_element_key() {
    let reference = HashMap::from([("element-6066-11e4".to_owned(), "id-1".to_owned())]);
    assert_eq!(element_id(&reference), Some("id-1"));
    assert_eq!(element_id(&HashMap::new()), None);
}

#[test]
fn command_parameters_keep_their_wire_shape() -> Result<()> {
    let cases = [
        (
            serde_json::to_value(NewSession::default())?,
            json!({"capabilities": {}}),
        ),
        (
            serde_json::to_value(SwitchToWindow::new("w"))?,
            json!({"name": "w", "handle": "w"}),
        ),
        (
            serde_json::to_value(NewWindow::FOCUSED_TAB)?,
            json!({"type": "tab", "focus": true}),
        ),
        (
            serde_json::to_value(ExecuteScript::new("s"))?,
            json!({"script": "s", "args": [], "scriptTimeout": 30_000}),
        ),
        (
            serde_json::to_value(PerformActions::key_press("k"))?,
            json!({"actions": [{"type": "key", "id": "kbd", "actions":
                [{"type": "keyDown", "value": "k"}, {"type": "keyUp", "value": "k"}]}]}),
        ),
        (
            serde_json::to_value(FindElement::css("a"))?,
            json!({"using": "css selector", "value": "a"}),
        ),
        (
            serde_json::to_value(InstallAddon::temporary("p"))?,
            json!({"path": "p", "temporary": true}),
        ),
    ];
    for (sent, expected) in cases {
        assert_eq!(sent, expected);
    }
    Ok(())
}

#[test]
fn a_promise_expression_reports_through_the_script_callback() {
    let wrapped = wrap_promise_expression("fetch('/')");
    assert!(wrapped.starts_with("fetch('/')\n.then(r => arguments[0](r)"));
}

#[tokio::test]
async fn answers_are_matched_by_id_and_errors_surface() -> Result<()> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let port = listener.local_addr()?.port();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await?;
        let hello = encode_packet(&json!({"applicationType": "gecko"}))?;
        stream.write_all(&hello).await?;
        let mut buffer = [0_u8; 1024];
        let _ = stream.read(&mut buffer).await?;
        stream
            .write_all(&encode_packet(&json!([1, 99, null, "stale"]))?)
            .await?;
        stream
            .write_all(&encode_packet(&json!([1, 1, null, {"sessionId": "s"}]))?)
            .await?;
        let _ = stream.read(&mut buffer).await?;
        stream
            .write_all(&encode_packet(
                &json!([1, 2, {"error": "no such window"}, null]),
            )?)
            .await?;
        Ok::<_, FirefoxError>(())
    });
    let mut client = Marionette::connect(port).await?;
    let failure = client.windows().await;
    assert!(matches!(failure, Err(FirefoxError::Failed(text)) if text.contains("no such window")));
    server
        .await
        .map_err(|error| FirefoxError::Failed(error.to_string()))??;
    Ok(())
}
