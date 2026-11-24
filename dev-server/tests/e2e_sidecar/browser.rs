//! A fake CDP browser: one `YouTube` tab on `/json`, whose debugger socket records every command.

use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;

pub(crate) type Calls = Arc<Mutex<Vec<String>>>;

async fn serve_http(mut stream: TcpStream, list: &str) {
    let mut sink = vec![0_u8; 4096];
    tokio::io::AsyncReadExt::read(&mut stream, &mut sink)
        .await
        .unwrap();
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{list}",
        list.len()
    );
    stream.write_all(response.as_bytes()).await.unwrap();
}

async fn serve_tab(stream: TcpStream, calls: Calls) {
    let mut socket = tokio_tungstenite::accept_async(stream).await.unwrap();
    while let Some(Ok(Message::Text(text))) = socket.next().await {
        let command: Value = serde_json::from_str(text.as_str()).unwrap();
        let expression = command["params"]["expression"].as_str().unwrap_or_default();
        calls.lock().unwrap().push(format!(
            "{} {expression}",
            command["method"].as_str().unwrap()
        ));
        let reply = json!({ "id": command["id"], "result": { "result": { "type": "undefined" } } });
        socket.send(Message::text(reply.to_string())).await.unwrap();
    }
}

pub(crate) struct FakeBrowser {
    pub(crate) port: u16,
    pub(crate) calls: Calls,
}

pub(crate) async fn start_browser() -> FakeBrowser {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let list = json!([{
        "id": "tab-a", "type": "page", "url": "https://www.youtube.com/watch?v=1",
        "webSocketDebuggerUrl": format!("ws://127.0.0.1:{port}/devtools/page/tab-a")
    }])
    .to_string();
    let calls = Calls::default();
    let served = Arc::clone(&calls);
    tokio::spawn(async move {
        loop {
            let (stream, _peer) = listener.accept().await.unwrap();
            let mut peeked = [0_u8; 16];
            stream.peek(&mut peeked).await.unwrap();
            let (list, served) = (list.clone(), Arc::clone(&served));
            tokio::spawn(async move {
                if peeked.starts_with(b"GET /json") {
                    serve_http(stream, &list).await;
                } else {
                    serve_tab(stream, served).await;
                }
            });
        }
    });
    FakeBrowser { port, calls }
}
