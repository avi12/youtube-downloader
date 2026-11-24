use std::time::Duration;

use tokio::io::{duplex, split, AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};
use tokio::io::{Lines, ReadHalf, WriteHalf};
use tracing_subscriber::layer::SubscriberExt;

use super::*;
use crate::bridge::Host;

const WAIT: Duration = Duration::from_secs(5);

struct FakeTypeScript {
    requests: Lines<BufReader<ReadHalf<DuplexStream>>>,
    stdin: WriteHalf<DuplexStream>,
}

impl FakeTypeScript {
    async fn next_line(&mut self) -> Result<String> {
        let line = tokio::time::timeout(WAIT, self.requests.next_line())
            .await
            .map_err(|_| Error::Timeout("a line from the sidecar"))??;
        line.ok_or(Error::BridgeClosed)
    }

    async fn send(&mut self, line: &str) -> Result<()> {
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.write_all(b"\n").await?;
        Ok(())
    }
}

fn start() -> Result<(BridgeLink, FakeTypeScript, CancellationToken)> {
    let (sidecar_stdin, ts_stdin) = duplex(4096);
    let (sidecar_stdout, ts_stdout) = duplex(4096);
    let shutdown = CancellationToken::new();
    let (stdin_reader, _unused_writer) = split(sidecar_stdin);
    let (_unused_reader, stdout_writer) = split(sidecar_stdout);
    let link = connect(
        BufReader::new(stdin_reader),
        stdout_writer,
        shutdown.clone(),
    )?;
    let (stdout_reader, _unused) = split(ts_stdout);
    let (_unused_read, stdin_writer) = split(ts_stdin);
    let fake = FakeTypeScript {
        requests: BufReader::new(stdout_reader).lines(),
        stdin: stdin_writer,
    };
    Ok((link, fake, shutdown))
}

#[tokio::test(start_paused = true)]
async fn a_call_round_trips_through_the_pipes() -> Result<()> {
    let (link, mut fake, _shutdown) = start()?;
    let client = link.client.clone();
    let call = tokio::spawn(async move { client.inject_hmr().await });
    assert_eq!(fake.next_line().await?, r#"{"id":0,"method":"injectHmr"}"#);
    fake.send(r#"{"id":0,"result":true}"#).await?;
    assert!(call.await.map_err(|_| Error::BridgeClosed)??);
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn typed_results_and_host_errors_come_back() -> Result<()> {
    let (link, mut fake, _shutdown) = start()?;
    let rebuild = tokio::spawn({
        let client = link.client.clone();
        async move { client.rebuild_hmr().await }
    });
    assert_eq!(fake.next_line().await?, r#"{"id":0,"method":"rebuildHmr"}"#);
    fake.send(r#"{"id":0,"result":{"hmrSourceFiles":["src/a.ts"]}}"#)
        .await?;
    let graph = rebuild.await.map_err(|_| Error::BridgeClosed)??;
    assert_eq!(graph.hmr_source_files.len(), 1);

    let build = tokio::spawn({
        let client = link.client.clone();
        async move { client.build_extension().await }
    });
    fake.next_line().await?;
    fake.send(r#"{"id":1,"error":"boom"}"#).await?;
    assert!(matches!(
        build.await.map_err(|_| Error::BridgeClosed)?,
        Err(Error::Host { message }) if message == "boom"
    ));
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn out_of_order_responses_find_their_calls() -> Result<()> {
    let (link, mut fake, _shutdown) = start()?;
    let first = tokio::spawn({
        let client = link.client.clone();
        async move { client.inject_hmr().await }
    });
    fake.next_line().await?;
    let second = tokio::spawn({
        let client = link.client.clone();
        async move { client.refresh_env().await }
    });
    fake.next_line().await?;
    fake.send(r#"{"id":1,"result":null}"#).await?;
    second.await.map_err(|_| Error::BridgeClosed)??;
    assert!(!first.is_finished());
    fake.send(r#"{"id":0,"result":false}"#).await?;
    assert!(!first.await.map_err(|_| Error::BridgeClosed)??);
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn garbage_and_unknown_ids_are_skipped() -> Result<()> {
    let (link, mut fake, _shutdown) = start()?;
    fake.send("not json").await?;
    fake.send("").await?;
    fake.send(r#"{"id":99,"result":1}"#).await?;
    let client = link.client.clone();
    let call = tokio::spawn(async move { client.inject_hmr().await });
    fake.next_line().await?;
    fake.send(r#"{"id":0,"result":true}"#).await?;
    assert!(call.await.map_err(|_| Error::BridgeClosed)??);
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn shutdown_notification_cancels_the_token_and_flushes_logs() -> Result<()> {
    let (mut link, mut fake, shutdown) = start()?;
    let subscriber = tracing_subscriber::registry().with(link.client.log_layer());
    tracing::subscriber::with_default(subscriber, || tracing::info!("last words"));
    fake.send(r#"{"notify":"shutdown"}"#).await?;
    shutdown.cancelled().await;
    assert_eq!(
        link.notifications.recv().await,
        Some(Notification::Shutdown)
    );
    assert_eq!(fake.next_line().await?, r#"{"log":"last words"}"#);
    tokio::time::timeout(WAIT, link.pump)
        .await
        .map_err(|_| Error::Timeout("the pump"))?
        .map_err(|_| Error::BridgeClosed)??;
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn eof_fails_in_flight_calls_and_later_ones() -> Result<()> {
    let (link, mut fake, _shutdown) = start()?;
    let client = link.client.clone();
    let pending = tokio::spawn(async move { client.refresh_env().await });
    fake.next_line().await?;
    fake.stdin.shutdown().await?;
    assert!(matches!(
        pending.await.map_err(|_| Error::BridgeClosed)?,
        Err(Error::BridgeClosed)
    ));
    tokio::time::timeout(WAIT, link.pump)
        .await
        .map_err(|_| Error::Timeout("the pump"))?
        .map_err(|_| Error::BridgeClosed)??;
    assert!(matches!(
        link.client.build_extension().await,
        Err(Error::BridgeClosed)
    ));
    Ok(())
}
