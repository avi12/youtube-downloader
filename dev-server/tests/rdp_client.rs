//! The RDP client against an in-process fake debugger server speaking the real framing.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use ytdl_dev_hot::driver::rdp::{encode_packet, PacketDecoder, RdpClient, RdpTimings};
use ytdl_dev_hot::driver::BrowserDriver;
use ytdl_dev_hot::types::Port;
use ytdl_dev_hot::{Error, Result};

const CONNECT_MS: u64 = 500;
const REPLY_MS: u64 = 500;
const AWAKE_BACKGROUND_MS: u64 = 150;
const WOKEN_BACKGROUND_MS: u64 = 300;
const PROBE_MS: u64 = 300;

const EXTENSION_ID: &str = "ytdl@example";
const EXTENSION_UUID: &str = "1111-2222";

type Requests = Arc<Mutex<Vec<Value>>>;

struct Fake {
    port: Port,
    requests: Requests,
}

fn short_timings() -> RdpTimings {
    RdpTimings {
        connect: Duration::from_millis(CONNECT_MS),
        reply: Duration::from_millis(REPLY_MS),
        awake_background: Duration::from_millis(AWAKE_BACKGROUND_MS),
        woken_background: Duration::from_millis(WOKEN_BACKGROUND_MS),
        probe: Duration::from_millis(PROBE_MS),
    }
}

fn client(fake: &Fake) -> RdpClient {
    RdpClient::with_timings(
        fake.port,
        EXTENSION_ID.into(),
        EXTENSION_UUID.into(),
        short_timings(),
    )
}

async fn write_split(stream: &mut TcpStream, packet: &Value) -> Result<()> {
    let bytes = encode_packet(packet)?;
    let (head, tail) = bytes.split_at(bytes.len() / 2);
    stream.write_all(head).await?;
    stream.flush().await?;
    tokio::task::yield_now().await;
    stream.write_all(tail).await?;
    Ok(())
}

/// Serves one connection: greets, then answers each request through `respond`.
async fn serve(respond: impl Fn(&Value) -> Vec<Value> + Send + 'static) -> Result<Fake> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = Port::new(listener.local_addr()?.port())?;
    let requests: Requests = Arc::default();
    let seen = Arc::clone(&requests);
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            if write_split(
                &mut stream,
                &json!({"from":"root","applicationType":"browser"}),
            )
            .await
            .is_err()
            {
                continue;
            }
            let mut decoder = PacketDecoder::default();
            let mut chunk = [0_u8; 4096];
            while let Ok(read) = stream.read(&mut chunk).await {
                let is_end_of_stream = read == 0;
                if is_end_of_stream {
                    break;
                }
                let Ok(packets) = decoder.push(chunk.get(..read).unwrap_or_default()) else {
                    break;
                };
                for request in packets {
                    if let Ok(mut log) = seen.lock() {
                        log.push(request.clone());
                    }
                    for reply in respond(&request) {
                        if write_split(&mut stream, &reply).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    });
    Ok(Fake { port, requests })
}

fn kind(request: &Value) -> &str {
    request
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn target(request: &Value) -> &str {
    request
        .get("to")
        .and_then(Value::as_str)
        .unwrap_or_default()
}

fn background_frame() -> Value {
    json!({"from":"watcher1","type":"target-available-form","target":{
        "url": format!("moz-extension://{EXTENSION_UUID}/_generated_background_page.html"),
        "consoleActor":"bgconsole"}})
}

fn evaluation(result: &Value) -> Vec<Value> {
    vec![
        json!({"from":"bgconsole","resultID":"r1"}),
        json!({"from":"unrelated","type":"tabNavigated"}),
        json!({"from":"bgconsole","type":"evaluationResult","resultID":"r1","result":result}),
    ]
}

fn awake_server(request: &Value, result: &Value) -> Vec<Value> {
    match (target(request), kind(request)) {
        ("root", "listAddons") => vec![json!({"from":"root","addons":[
            {"id":"other@x","actor":"addonOther"},
            {"id":EXTENSION_ID,"actor":"addon1"}]})],
        ("addon1", "getWatcher") => vec![json!({"from":"addon1","actor":"watcher1"})],
        ("watcher1", "watchTargets") => vec![background_frame()],
        ("bgconsole", "evaluateJSAsync") => evaluation(result),
        _ => vec![],
    }
}

fn sent_to(fake: &Fake, actor: &str, request_kind: &str) -> Vec<Value> {
    let log = fake
        .requests
        .lock()
        .map_or_else(|_poisoned| Vec::new(), |guard| guard.clone());
    log.into_iter()
        .filter(|request| target(request) == actor && kind(request) == request_kind)
        .collect()
}

#[tokio::test]
async fn tabs_are_reloaded_through_the_background_console() -> Result<()> {
    let fake = serve(|request| awake_server(request, &json!(3))).await?;
    assert_eq!(client(&fake).reload_youtube_tabs().await?, 3);
    let evaluations = sent_to(&fake, "bgconsole", "evaluateJSAsync");
    assert_eq!(evaluations.len(), 1);
    let text = evaluations
        .first()
        .and_then(|req| req.get("text"))
        .and_then(Value::as_str);
    assert!(text.is_some_and(|code| code.contains("browser.tabs.reload")));
    let awaits = evaluations
        .first()
        .and_then(|req| req.pointer("/mapped/await"));
    assert_eq!(awaits, Some(&json!(true)));
    assert_eq!(sent_to(&fake, "addon1", "getWatcher").len(), 1);
    assert_eq!(sent_to(&fake, "addonOther", "getWatcher").len(), 0);
    Ok(())
}

#[tokio::test]
async fn extension_pages_reload_reports_whether_any_view_matched() -> Result<()> {
    let fake = serve(|request| awake_server(request, &json!(2))).await?;
    assert!(client(&fake).reload_extension_pages("popup").await?);
    let sent = sent_to(&fake, "bgconsole", "evaluateJSAsync");
    let text = sent
        .first()
        .and_then(|req| req.get("text"))
        .and_then(Value::as_str);
    assert!(text.is_some_and(|code| code.contains("\"/popup.html\"")));

    let none = serve(|request| awake_server(request, &json!(0))).await?;
    assert!(!client(&none).reload_extension_pages("popup").await?);
    Ok(())
}

#[tokio::test]
async fn a_suspended_background_is_woken_through_the_main_process() -> Result<()> {
    let fake = serve(|request| match (target(request), kind(request)) {
        ("watcher1", "watchTargets") => vec![],
        ("root", "getProcess") => {
            vec![json!({"from":"root","processDescriptor":{"actor":"proc1"}})]
        }
        ("proc1", "getTarget") => {
            vec![json!({"from":"proc1","process":{"consoleActor":"mainconsole"}})]
        }
        ("mainconsole", "evaluateJSAsync") => vec![
            json!({"from":"mainconsole","resultID":"w1"}),
            background_frame(),
            json!({"from":"mainconsole","type":"evaluationResult","resultID":"w1"}),
        ],
        _ => awake_server(request, &json!(1)),
    })
    .await?;
    assert_eq!(client(&fake).reload_youtube_tabs().await?, 1);
    let wake = sent_to(&fake, "mainconsole", "evaluateJSAsync");
    let text = wake
        .first()
        .and_then(|req| req.get("text"))
        .and_then(Value::as_str);
    assert!(
        text.is_some_and(|code| code.contains("wakeupBackground") && code.contains(EXTENSION_ID))
    );
    assert_eq!(sent_to(&fake, "bgconsole", "evaluateJSAsync").len(), 1);
    Ok(())
}

#[tokio::test]
async fn an_unknown_extension_reloads_nothing() -> Result<()> {
    let fake = serve(|request| match kind(request) {
        "listAddons" => vec![json!({"from":"root","addons":[{"id":"other@x","actor":"a"}]})],
        _ => vec![],
    })
    .await?;
    assert_eq!(client(&fake).reload_youtube_tabs().await?, 0);
    Ok(())
}

#[tokio::test]
async fn a_server_that_never_answers_times_out() -> Result<()> {
    let fake = serve(|_| vec![]).await?;
    let outcome = client(&fake).reload_youtube_tabs().await;
    assert!(matches!(outcome, Err(Error::Timeout(_))));
    Ok(())
}

#[tokio::test]
async fn liveness_follows_the_listener() -> Result<()> {
    let fake = serve(|_| vec![]).await?;
    assert!(client(&fake).is_alive().await);
    let dead = TcpListener::bind("127.0.0.1:0").await?;
    let port = Port::new(dead.local_addr()?.port())?;
    drop(dead);
    let gone = RdpClient::with_timings(
        port,
        EXTENSION_ID.into(),
        EXTENSION_UUID.into(),
        short_timings(),
    );
    assert!(!gone.is_alive().await);
    Ok(())
}
