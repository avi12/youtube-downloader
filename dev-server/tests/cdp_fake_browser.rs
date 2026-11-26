//! The CDP client against an in-process fake browser: `/json/list` over HTTP and one WebSocket
//! per target, on a single loopback listener.

use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use ytdl_dev_hot::driver::cdp::CdpClient;
use ytdl_dev_hot::driver::BrowserDriver;
use ytdl_dev_hot::types::Port;
use ytdl_dev_hot::Result;

const HANG_SECONDS: u64 = 30;

type CallLog = Arc<Mutex<Vec<String>>>;

struct Fake {
    client: CdpClient,
    calls: CallLog,
}

impl Fake {
    fn calls(&self) -> Vec<String> {
        let mut calls = self.calls.lock().unwrap().clone();
        calls.sort();
        calls
    }
}

fn target(port: u16, id: &str, kind: &str, url: &str) -> Value {
    json!({
        "id": id,
        "type": kind,
        "url": url,
        "webSocketDebuggerUrl": format!("ws://127.0.0.1:{port}/devtools/page/{id}"),
    })
}

async fn serve_http(mut stream: TcpStream, list: &str) {
    let mut peeked = [0_u8; 32];
    let read = stream.peek(&mut peeked).await.unwrap();
    let request = String::from_utf8_lossy(&peeked[..read]).to_string();
    let body = if request.contains("/json/version") {
        "{}".to_owned()
    } else {
        list.to_owned()
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let mut sink = vec![0_u8; 4096];
    tokio::io::AsyncReadExt::read(&mut stream, &mut sink)
        .await
        .unwrap();
    stream.write_all(response.as_bytes()).await.unwrap();
    // Like Chrome's DevTools server: `Connection: close` is ignored and the socket stays open.
    tokio::time::sleep(std::time::Duration::from_secs(HANG_SECONDS)).await;
}

async fn serve_websocket(stream: TcpStream, calls: CallLog, popup_tab: &'static str) {
    let mut peeked = [0_u8; 128];
    let read = stream.peek(&mut peeked).await.unwrap();
    let request = String::from_utf8_lossy(&peeked[..read]).to_string();
    let tab = request
        .split_whitespace()
        .nth(1)
        .unwrap()
        .rsplit('/')
        .next()
        .unwrap()
        .to_owned();
    let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
    while let Some(Ok(Message::Text(text))) = socket.next().await {
        let command: Value = serde_json::from_str(text.as_str()).unwrap();
        let method = command["method"].as_str().unwrap().to_owned();
        let detail = match method.as_str() {
            "Page.navigate" => command["params"]["frameId"].as_str().unwrap().to_owned(),
            "Runtime.evaluate" => command["params"]["expression"].as_str().unwrap().to_owned(),
            _ => String::new(),
        };
        calls
            .lock()
            .unwrap()
            .push(format!("{tab} {method} {detail}"));
        let mut tree = json!({ "frame": { "id": "main", "url": "https://www.youtube.com/" } });
        let is_popup_tab = tab == popup_tab;
        if is_popup_tab {
            tree["childFrames"] = json!([{ "frame": { "id": "popup-frame",
                "url": "chrome-extension://abc/popup.html" } }]);
        }
        let result = match method.as_str() {
            "Page.getFrameTree" => json!({ "frameTree": tree }),
            "Runtime.evaluate" => json!({ "result": { "type": "undefined" } }),
            _ => json!({}),
        };
        let reply = json!({ "id": command["id"], "result": result });
        socket.send(Message::text(reply.to_string())).await.unwrap();
    }
}

async fn start_fake(targets: impl FnOnce(u16) -> Vec<Value>) -> Result<Fake> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let list = serde_json::to_string(&targets(port))?;
    let calls = CallLog::default();
    let served = Arc::clone(&calls);
    tokio::spawn(async move {
        loop {
            let (stream, _peer) = listener.accept().await.unwrap();
            let mut peeked = [0_u8; 16];
            stream.peek(&mut peeked).await.unwrap();
            let is_list = peeked.starts_with(b"GET /json");
            let (list, served) = (list.clone(), Arc::clone(&served));
            tokio::spawn(async move {
                if is_list {
                    serve_http(stream, &list).await;
                    return;
                }
                serve_websocket(stream, served, "tab-b").await;
            });
        }
    });
    Ok(Fake {
        client: CdpClient::new(Port::new(port)?),
        calls,
    })
}

fn mixed_targets(port: u16) -> Vec<Value> {
    vec![
        target(port, "tab-a", "page", "https://www.youtube.com/watch?v=1"),
        target(port, "tab-b", "page", "https://www.youtube.com/"),
        target(port, "tab-a", "page", "https://www.youtube.com/watch?v=1"),
        target(port, "other", "page", "https://example.com/"),
        target(
            port,
            "worker",
            "service_worker",
            "https://www.youtube.com/sw.js",
        ),
        json!({ "id": "held", "type": "page", "url": "https://www.youtube.com/held" }),
    ]
}

#[tokio::test]
async fn only_youtube_tabs_are_reloaded_and_never_twice() -> Result<()> {
    let fake = start_fake(mixed_targets).await?;
    assert_eq!(fake.client.reload_youtube_tabs().await?, 2);
    assert_eq!(
        fake.calls(),
        [
            "tab-a Runtime.evaluate location.reload()",
            "tab-b Runtime.evaluate location.reload()"
        ]
    );
    Ok(())
}

#[tokio::test]
async fn an_open_extension_page_is_reloaded_by_entrypoint_name() -> Result<()> {
    let fake = start_fake(|port| {
        vec![
            target(
                port,
                "popup-page",
                "page",
                "chrome-extension://abc/popup.html",
            ),
            target(
                port,
                "grant-page",
                "page",
                "chrome-extension://abc/grant.html",
            ),
            target(port, "tab-a", "page", "https://www.youtube.com/"),
        ]
    })
    .await?;
    assert!(fake.client.reload_extension_pages("popup").await?);
    assert_eq!(
        fake.calls(),
        ["popup-page Runtime.evaluate location.reload()"]
    );
    Ok(())
}

#[tokio::test]
async fn an_iframed_entrypoint_is_navigated_in_place() -> Result<()> {
    let fake = start_fake(mixed_targets).await?;
    assert!(fake.client.reload_extension_pages("popup").await?);
    assert_eq!(
        fake.calls(),
        [
            "tab-a Page.getFrameTree ",
            "tab-b Page.getFrameTree ",
            "tab-b Page.navigate popup-frame"
        ]
    );
    Ok(())
}

#[tokio::test]
async fn an_entrypoint_that_is_not_open_reloads_nothing() -> Result<()> {
    let fake = start_fake(mixed_targets).await?;
    assert!(!fake.client.reload_extension_pages("grant").await?);
    Ok(())
}

#[tokio::test]
async fn a_live_browser_is_alive_and_a_dead_port_is_not() -> Result<()> {
    let fake = start_fake(mixed_targets).await?;
    assert!(fake.client.is_alive().await);
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let dead = CdpClient::new(Port::new(listener.local_addr()?.port())?);
    drop(listener);
    assert!(!dead.is_alive().await);
    assert!(dead.reload_youtube_tabs().await.is_err());
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn a_browser_that_never_answers_times_out() -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    tokio::spawn(async move {
        let mut held = Vec::new();
        while let Ok((stream, _peer)) = listener.accept().await {
            held.push(stream);
        }
    });
    let silent = CdpClient::new(Port::new(port)?);
    assert!(matches!(
        silent.list_targets().await,
        Err(ytdl_dev_hot::Error::Timeout(_))
    ));
    Ok(())
}
