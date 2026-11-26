//! The HMR push server over real loopback sockets, with a short ping interval.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use tokio_util::sync::CancellationToken;
use ytdl_dev_hot::hmr_server::{
    manifest_path, manifest_payload, serve, serve_listener_pinging, write_manifest_extras,
    HmrHandle, ManifestExtras, HMR_DIRECTORY,
};
use ytdl_dev_hot::types::Port;
use ytdl_dev_hot::{Error, Result};

type Client = WebSocketStream<MaybeTlsStream<TcpStream>>;

const PING_INTERVAL: Duration = Duration::from_millis(60);
const WAIT: Duration = Duration::from_secs(5);
const PING: &str = r#"{"type":"ping"}"#;

struct Scratch(PathBuf);

impl Scratch {
    fn new() -> Result<Self> {
        static NEXT: AtomicU32 = AtomicU32::new(0);
        let path = std::env::temp_dir().join(format!(
            "ytdl-hmr-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(path.join(HMR_DIRECTORY))?;
        Ok(Self(path))
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn write_manifest(&self, text: &str) -> Result<()> {
        Ok(std::fs::write(manifest_path(&self.0), text)?)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn start(directory: &Path) -> Result<(HmrHandle, SocketAddr, CancellationToken)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let shutdown = CancellationToken::new();
    let handle = serve_listener_pinging(listener, directory, shutdown.clone(), PING_INTERVAL);
    Ok((handle, address, shutdown))
}

async fn connect(address: SocketAddr) -> Result<Client> {
    let (client, _) = connect_async(format!("ws://{address}")).await?;
    Ok(client)
}

async fn next_text(client: &mut Client) -> Result<String> {
    loop {
        let frame = tokio::time::timeout(WAIT, client.next())
            .await
            .map_err(|_| Error::Timeout("a frame"))?;
        match frame {
            Some(Ok(Message::Text(text))) => return Ok(text.as_str().to_owned()),
            Some(Ok(_)) => {}
            Some(Err(error)) => return Err(error.into()),
            None => return Err(Error::BridgeClosed),
        }
    }
}

async fn is_closed_soon(client: &mut Client) -> bool {
    tokio::time::timeout(WAIT, async {
        loop {
            match client.next().await {
                Some(Ok(Message::Text(_) | Message::Ping(_) | Message::Pong(_))) => {}
                _ => return,
            }
        }
    })
    .await
    .is_ok()
}

async fn wait_for_clients(handle: &HmrHandle, count: usize) -> Result<()> {
    tokio::time::timeout(WAIT, async {
        loop {
            let is_awaiting_clients = handle.client_count() != count;
            if !is_awaiting_clients {
                break;
            }

            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .map_err(|_| Error::Timeout("the client count"))
}

#[tokio::test]
async fn a_new_client_is_synced_and_receives_broadcasts() -> Result<()> {
    let scratch = Scratch::new()?;
    scratch.write_manifest(r#"{"modules":{}}"#)?;
    let (handle, address, shutdown) = start(scratch.path()).await?;
    let mut client = connect(address).await?;
    assert_eq!(
        next_text(&mut client).await?,
        r#"{"type":"manifest","manifest":{"modules":{}}}"#
    );
    assert!(handle.since_last_import_push().is_some());
    wait_for_clients(&handle, 1).await?;
    handle.broadcast_reload_imminent();
    assert_eq!(
        next_text(&mut client).await?,
        r#"{"type":"reload-imminent"}"#
    );
    handle.broadcast_manifest(&Arc::from(r#"{"type":"manifest","manifest":1}"#));
    assert_eq!(
        next_text(&mut client).await?,
        r#"{"type":"manifest","manifest":1}"#
    );
    shutdown.cancel();
    Ok(())
}

#[tokio::test]
async fn no_manifest_means_no_initial_sync_and_no_push_stamp() -> Result<()> {
    let scratch = Scratch::new()?;
    let (handle, address, shutdown) = start(scratch.path()).await?;
    let _client = connect(address).await?;
    wait_for_clients(&handle, 1).await?;
    assert_eq!(handle.since_last_import_push(), None);
    shutdown.cancel();
    Ok(())
}

#[tokio::test]
async fn a_client_that_answers_pings_stays_and_a_silent_one_is_dropped() -> Result<()> {
    let scratch = Scratch::new()?;
    let (handle, address, shutdown) = start(scratch.path()).await?;
    let mut polite = connect(address).await?;
    let mut silent = connect(address).await?;
    wait_for_clients(&handle, 2).await?;
    for _ in 0..4 {
        assert_eq!(next_text(&mut polite).await?, PING);
        polite.send(Message::text(r#"{"type":"pong"}"#)).await?;
    }
    polite.send(Message::text("not json")).await?;
    assert_eq!(next_text(&mut silent).await?, PING);
    wait_for_clients(&handle, 1).await?;
    assert!(is_closed_soon(&mut silent).await);
    assert_eq!(next_text(&mut polite).await?, PING);
    shutdown.cancel();
    Ok(())
}

#[tokio::test]
async fn shutdown_closes_every_client() -> Result<()> {
    let scratch = Scratch::new()?;
    let (handle, address, shutdown) = start(scratch.path()).await?;
    let mut client = connect(address).await?;
    wait_for_clients(&handle, 1).await?;
    shutdown.cancel();
    wait_for_clients(&handle, 0).await?;
    assert!(is_closed_soon(&mut client).await);
    Ok(())
}

#[tokio::test]
async fn serve_binds_the_given_port_on_loopback() -> Result<()> {
    let probe = TcpListener::bind("127.0.0.1:0").await?;
    let address = probe.local_addr()?;
    let port = Port::new(address.port())?;
    drop(probe);
    let scratch = Scratch::new()?;
    let shutdown = CancellationToken::new();
    let handle = serve(port, scratch.path(), shutdown.clone()).await?;
    let _client = connect(address).await?;
    wait_for_clients(&handle, 1).await?;
    shutdown.cancel();
    Ok(())
}

#[test]
fn manifest_extras_merge_into_the_built_manifest() -> Result<()> {
    let scratch = Scratch::new()?;
    assert_eq!(manifest_payload(scratch.path())?, None);
    write_manifest_extras(scratch.path(), &ManifestExtras::default())?;
    scratch.write_manifest(r#"{"version":3,"modules":{"a":"h"}}"#)?;
    let mut extras = ManifestExtras::default();
    extras
        .overlay
        .insert("hello".into(), json!({"message": "Hi"}));
    extras
        .resource_versions
        .insert("/icons/a.png".into(), "abc123".into());
    write_manifest_extras(scratch.path(), &extras)?;
    let payload = manifest_payload(scratch.path())?.ok_or(Error::BridgeClosed)?;
    let parsed: Value = serde_json::from_str(&payload)?;
    assert_eq!(parsed["type"], "manifest");
    assert_eq!(parsed["manifest"]["version"], 3);
    assert_eq!(parsed["manifest"]["overlay"]["hello"]["message"], "Hi");
    assert_eq!(
        parsed["manifest"]["resourceVersions"]["/icons/a.png"],
        "abc123"
    );
    assert!(!manifest_path(scratch.path())
        .with_extension("json.tmp")
        .exists());
    Ok(())
}
