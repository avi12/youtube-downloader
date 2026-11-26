//! The RDP wire framing: `<byte length>:<json>`, in both directions.

use serde::Serialize;
use serde_json::Value;

use crate::error::{Error, Result};

/// Encodes one RDP packet: `<byte length>:<json>`.
///
/// ```
/// use serde_json::json;
/// use ytdl_dev_hot::driver::rdp::encode_packet;
///
/// assert_eq!(encode_packet(&json!({"to":"root"}))?, b"13:{\"to\":\"root\"}");
/// # Ok::<(), ytdl_dev_hot::Error>(())
/// ```
pub fn encode_packet<T: Serialize + ?Sized>(packet: &T) -> Result<Vec<u8>> {
    let body = serde_json::to_string(packet)?;
    Ok(format!("{}:{body}", body.len()).into_bytes())
}

/// Reassembles packets from a byte stream that splits and joins them arbitrarily. The framing is
/// shared by RDP and Marionette, so packets stay untyped here and each client parses its own.
#[derive(Debug, Default)]
pub struct PacketDecoder {
    buffer: Vec<u8>,
}

impl PacketDecoder {
    /// Feeds bytes and returns every packet completed by them, in order.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Value>> {
        self.buffer.extend_from_slice(bytes);
        let mut packets = Vec::new();
        while let Some(packet) = self.next_packet()? {
            packets.push(packet);
        }
        Ok(packets)
    }

    fn next_packet(&mut self) -> Result<Option<Value>> {
        let Some(colon) = self.buffer.iter().position(|byte| *byte == b':') else {
            return Ok(None);
        };
        let header = self.buffer.get(..colon).unwrap_or_default();
        let length: usize = std::str::from_utf8(header)
            .ok()
            .and_then(|text| text.parse().ok())
            .ok_or_else(|| Error::Protocol("bad RDP length header".into()))?;
        let body_start = colon + 1;
        let body_end = body_start + length;
        let Some(body) = self.buffer.get(body_start..body_end) else {
            return Ok(None);
        };
        let packet = serde_json::from_slice(body)?;
        self.buffer.drain(..body_end);
        Ok(Some(packet))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::driver::rdp::packet::*;

    const HEADER_SPLIT_INDEX: usize = 5;

    #[test]
    fn a_packet_split_across_reads_is_reassembled() -> Result<()> {
        let bytes = encode_packet(&json!({"from":"root","applicationType":"browser"}))?;
        let (head, tail) = bytes.split_at(HEADER_SPLIT_INDEX);
        let mut decoder = PacketDecoder::default();
        assert_eq!(decoder.push(head)?, Vec::<Value>::new());
        assert_eq!(
            decoder.push(tail)?,
            vec![json!({"from":"root","applicationType":"browser"})]
        );
        Ok(())
    }

    #[test]
    fn two_packets_in_one_read_come_out_in_order() -> Result<()> {
        let mut bytes = encode_packet(&json!({"a":1}))?;
        bytes.extend(encode_packet(&json!({"b":2}))?);
        assert_eq!(
            PacketDecoder::default().push(&bytes)?,
            vec![json!({"a":1}), json!({"b":2})]
        );
        Ok(())
    }

    #[test]
    fn a_non_numeric_header_is_a_protocol_error() {
        assert!(matches!(
            PacketDecoder::default().push(b"xx:{}"),
            Err(Error::Protocol(_))
        ));
    }
}
