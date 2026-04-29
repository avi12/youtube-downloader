import type { FormatProgress } from "./types";
import { MediaHeader, UMPPartId } from "googlevideo/protos";
import { CompositeBuffer, UmpReader } from "googlevideo/ump";

function compositeBufferToUint8(buffer: CompositeBuffer): Uint8Array {
  const out = new Uint8Array(buffer.totalLength);
  let offset = 0;
  for (const chunk of buffer.chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function ingestUmpResponse({ response, audio, video, audioItag, videoItag }: {
  response: Uint8Array;
  audio: FormatProgress;
  video: FormatProgress;
  audioItag: number;
  videoItag: number;
}) {
  const reader = new UmpReader(new CompositeBuffer([response]));
  let pendingItag = -1;
  let nextRequestPolicyBytes: Uint8Array | null = null;
  reader.read((part: {
    type: number;
    size: number;
    data: CompositeBuffer;
  }) => {
    const partBytes = compositeBufferToUint8(part.data);
    if (part.type === UMPPartId.MEDIA_HEADER) {
      const header = MediaHeader.decode(partBytes);
      const itag = header.itag ?? -1;
      pendingItag = itag;
      const startMs = parseInt(header.startMs ?? "0", 10);
      const durMs = parseInt(header.durationMs ?? "0", 10);
      const endMs = startMs + durMs;
      let target: FormatProgress | null = null;
      if (itag === audioItag) {
        target = audio;
      } else if (itag === videoItag) {
        target = video;
      }

      if (target) {
        if (endMs > target.endMs) {
          target.endMs = endMs;
        }

        if ((header.sequenceNumber ?? 0) > target.lastSeq) {
          target.lastSeq = header.sequenceNumber ?? target.lastSeq;
        }
      }
    } else if (part.type === UMPPartId.MEDIA) {
      const payload = partBytes.subarray(1);
      let target: FormatProgress | null = null;
      if (pendingItag === audioItag) {
        target = audio;
      } else if (pendingItag === videoItag) {
        target = video;
      }

      if (target) {
        const seq = target.lastSeq;
        const existing = target.segmentBytes.get(seq);
        if (existing) {
          const merged = new Uint8Array(existing.byteLength + payload.byteLength);
          merged.set(existing, 0);
          merged.set(payload, existing.byteLength);
          target.segmentBytes.set(seq, merged);
        } else {
          target.segmentBytes.set(seq, payload);
        }
      }
    } else if (part.type === UMPPartId.NEXT_REQUEST_POLICY) {
      nextRequestPolicyBytes = partBytes;
    }
  });
  return nextRequestPolicyBytes;
}

export function buildContiguousBytes(format: FormatProgress): Uint8Array {
  const sortedSeqs = [...format.segmentBytes.keys()].sort((seqA, seqB) => seqA - seqB);
  const total = sortedSeqs.reduce(
    (sum, seq) => sum + (format.segmentBytes.get(seq)?.byteLength ?? 0),
    0
  );
  const out = new Uint8Array(total);
  let offset = 0;
  for (const seq of sortedSeqs) {
    const bytes = format.segmentBytes.get(seq);
    if (bytes) {
      out.set(bytes, offset);
      offset += bytes.byteLength;
    }
  }
  return out;
}
