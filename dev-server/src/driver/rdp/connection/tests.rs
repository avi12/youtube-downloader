use serde_json::json;
use tokio::io::{duplex, DuplexStream};

use super::*;

const LIMIT: Duration = Duration::from_secs(1);

async fn push(server: &mut DuplexStream, packet: &Value) -> Result<()> {
    server.write_all(&encode_packet(packet)?).await?;
    Ok(())
}

#[tokio::test]
async fn unmatched_packets_stay_queued_for_a_later_wait() -> Result<()> {
    let (client, mut server) = duplex(4096);
    let mut connection = Connection::new(client);
    push(&mut server, &json!({"from":"noise"})).await?;
    push(&mut server, &json!({"from":"wanted"})).await?;
    let wanted = ActorId::new("wanted");
    connection
        .wait_for(LIMIT, "x", |packet| packet.is_from(&wanted))
        .await?;
    let noise = ActorId::new("noise");
    let late = connection
        .wait_for(LIMIT, "x", |packet| packet.is_from(&noise))
        .await?;
    assert!(late.is_from(&noise));
    Ok(())
}

#[tokio::test]
async fn evaluation_result_is_correlated_under_interleaving() -> Result<()> {
    let (client, mut server) = duplex(4096);
    let mut connection = Connection::new(client);
    let console = ActorId::new("console1");
    for packet in [
        json!({"from":"console1","type":"evaluationResult","resultID":"old","result":9}),
        json!({"from":"console1","resultID":"mine"}),
        json!({"from":"other","type":"evaluationResult","resultID":"mine","result":8}),
        json!({"from":"console1","type":"evaluationResult","resultID":"mine","result":2}),
    ] {
        push(&mut server, &packet).await?;
    }
    let result = connection
        .evaluate(&console, "1+1", Evaluation::Awaited, LIMIT)
        .await?;
    assert_eq!(result.result, Some(json!(2)));
    let mut chunk = [0_u8; 1024];
    let read = server.read(&mut chunk).await?;
    let sent = PacketDecoder::default().push(chunk.get(..read).unwrap_or_default())?;
    assert_eq!(
        sent,
        vec![
            json!({"to":"console1","type":"evaluateJSAsync","text":"1+1","mapped":{"await":true}})
        ]
    );
    Ok(())
}

#[tokio::test]
async fn an_unknown_packet_type_is_kept_but_never_an_acknowledgement() -> Result<()> {
    let (client, mut server) = duplex(4096);
    let mut connection = Connection::new(client);
    push(
        &mut server,
        &json!({"from":"a","type":"pageError","resultID":"x"}),
    )
    .await?;
    let actor = ActorId::new("a");
    let packet = connection
        .wait_for(LIMIT, "x", |packet| packet.is_from(&actor))
        .await?;
    assert_eq!(packet.kind, Some(PacketKind::Other));
    Ok(())
}

#[tokio::test(start_paused = true)]
async fn a_silent_peer_times_out() {
    let (client, _server) = duplex(64);
    let mut connection = Connection::new(client);
    let waited = connection.wait_for(LIMIT, "silence", |_| true).await;
    assert!(matches!(waited, Err(Error::Timeout("silence"))));
}

#[tokio::test]
async fn a_packet_arriving_byte_by_byte_is_read() -> Result<()> {
    let (client, mut server) = duplex(4096);
    let mut connection = Connection::new(client);
    let bytes = encode_packet(&json!({"from":"slow"}))?;
    let writer = tokio::spawn(async move {
        for byte in bytes {
            if server.write_all(&[byte]).await.is_err() {
                return;
            }
            tokio::task::yield_now().await;
        }
    });
    let slow = ActorId::new("slow");
    connection
        .wait_for(LIMIT, "x", |packet| packet.is_from(&slow))
        .await?;
    writer
        .await
        .map_err(|error| Error::Protocol(error.to_string()))?;
    Ok(())
}

#[tokio::test]
async fn a_closed_socket_is_a_protocol_error() {
    let (client, server) = duplex(64);
    drop(server);
    let mut connection = Connection::new(client);
    let waited = connection.wait_for(LIMIT, "x", |_| true).await;
    assert!(matches!(waited, Err(Error::Protocol(_))));
}
