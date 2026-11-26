use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use ytdl_dev_hot::driver::rdp::encode_packet;

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
