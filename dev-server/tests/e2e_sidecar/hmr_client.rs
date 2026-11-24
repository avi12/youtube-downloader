//! A real HMR WebSocket client that answers pings and keeps every other message.

use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::{eventually, POLL_STEP, WAIT};

pub(crate) struct HmrClient {
    pub(crate) messages: Arc<Mutex<Vec<String>>>,
}

impl HmrClient {
    pub(crate) async fn connect(port: u16) -> Self {
        let url = format!("ws://127.0.0.1:{port}");
        let socket = timeout(WAIT, async {
            loop {
                if let Ok((socket, _response)) = connect_async(&url).await {
                    return socket;
                }
                sleep(POLL_STEP).await;
            }
        })
        .await
        .unwrap();
        let (mut sink, mut stream) = socket.split();
        let messages = Arc::new(Mutex::new(Vec::new()));
        let seen = Arc::clone(&messages);
        tokio::spawn(async move {
            while let Some(Ok(Message::Text(text))) = stream.next().await {
                if text.as_str().contains(r#""type":"ping""#) {
                    sink.send(Message::text(r#"{"type":"pong"}"#))
                        .await
                        .unwrap();
                    continue;
                }
                seen.lock().unwrap().push(text.to_string());
            }
        });
        Self { messages }
    }

    pub(crate) fn all(&self) -> Vec<String> {
        self.messages.lock().unwrap().clone()
    }

    pub(crate) async fn message_with(&self, needle: &str) -> Value {
        let text = eventually(needle, || {
            self.all().into_iter().find(|text| text.contains(needle))
        })
        .await;
        serde_json::from_str(&text).unwrap()
    }
}
