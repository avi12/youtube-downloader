// Firefox-only SABR download path that bypasses the googlevideo
// SabrStream library. The library's state machine loses track of media when
// we seed it with YT player's captured body (mid-session, server doesn't
// resend FORMAT_INITIALIZATION_METADATA), so it emits `finish` with no
// segments. This module parses UMP responses directly and extracts MEDIA
// parts keyed to the YT-player-selected format, sidestepping the library's
// format-initialization state entirely.
//
// Approach:
//   1. Take YT player's captured request body (from webRequest) as template.
//   2. POST to captured URL. Cookies/Auth/Origin are injected by the
//      background webRequest listener in entrypoints/background/index.ts.
//   3. Parse the UMP response. MEDIA_HEADER parts announce segments with a
//      headerId and formatId. Subsequent MEDIA parts carry a headerId that
//      ties them back to that announcement.
//   4. Group MEDIA bytes by formatId, concatenate in segment-number order.

import { extractPreferredFormatItagsFromBody } from "./sabr-request-capture";

const UMP_PART_MEDIA_HEADER = 20;
const UMP_PART_MEDIA = 21;
const UMP_PART_MEDIA_END = 22;

const PROTO_WIRE_VARINT = 0;
const PROTO_WIRE_LENGTH_DELIMITED = 2;

interface UmpPart {
  type: number;
  data: Uint8Array;
}

function readUmpVarInt(buf: Uint8Array, offset: number): [number, number] {
  if (offset >= buf.byteLength) {
    return [-1, offset];
  }

  const first = buf[offset];
  const byteLen = first < 128 ? 1 : first < 192 ? 2 : first < 224 ? 3 : first < 240 ? 4 : 5;
  if (offset + byteLen > buf.byteLength) {
    return [-1, offset];
  }

  let value: number;
  if (byteLen === 1) {
    value = first;
  } else if (byteLen === 2) {
    value = (first & 0x3f) + 64 * buf[offset + 1];
  } else if (byteLen === 3) {
    value = (first & 0x1f) + 32 * (buf[offset + 1] + 256 * buf[offset + 2]);
  } else if (byteLen === 4) {
    value = (first & 0x0f)
      + 16 * (buf[offset + 1] + 256 * (buf[offset + 2] + 256 * buf[offset + 3]));
  } else {
    value = buf[offset + 1] + 256 * (buf[offset + 2] + 256 * (buf[offset + 3] + 256 * buf[offset + 4]));
  }

  return [value, offset + byteLen];
}

function parseUmpResponse(body: Uint8Array): UmpPart[] {
  const parts: UmpPart[] = [];
  let offset = 0;
  while (offset < body.byteLength) {
    const [type, afterType] = readUmpVarInt(body, offset);
    if (type < 0) {
      break;
    }

    const [size, afterSize] = readUmpVarInt(body, afterType);
    if (size < 0 || afterSize + size > body.byteLength) {
      break;
    }

    parts.push({
      type,
      data: body.subarray(afterSize, afterSize + size)
    });
    offset = afterSize + size;
  }

  return parts;
}

function readProtobufVarint(buf: Uint8Array, offset: number): [number, number] {
  let value = 0;
  let shift = 0;
  while (offset < buf.byteLength) {
    const byte = buf[offset];
    offset++;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return [value >>> 0, offset];
    }

    shift += 7;
  }
  return [-1, offset];
}

interface MediaHeader {
  headerId: number;
  itag: number;
  sequenceNumber: number;
}

function parseMediaHeader(data: Uint8Array): MediaHeader | null {
  let headerId = 0;
  let itag = 0;
  let sequenceNumber = 0;
  let offset = 0;
  while (offset < data.byteLength) {
    const [tag, afterTag] = readProtobufVarint(data, offset);
    if (tag < 0) {
      return null;
    }

    offset = afterTag;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;

    if (wireType === PROTO_WIRE_VARINT) {
      const [value, nextOffset] = readProtobufVarint(data, offset);
      if (value < 0) {
        return null;
      }

      if (fieldNumber === 1) {
        headerId = value;
      } else if (fieldNumber === 3) {
        sequenceNumber = value;
      }

      offset = nextOffset;
    } else if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
      const [length, afterLength] = readProtobufVarint(data, offset);
      if (length < 0 || afterLength + length > data.byteLength) {
        return null;
      }

      if (fieldNumber === 2) {
        // formatId sub-message: field 1 is itag (varint)
        const formatIdBytes = data.subarray(afterLength, afterLength + length);
        let inner = 0;
        while (inner < formatIdBytes.byteLength) {
          const [innerTag, afterInnerTag] = readProtobufVarint(formatIdBytes, inner);
          if (innerTag < 0) {
            break;
          }

          inner = afterInnerTag;
          const innerField = innerTag >> 3;
          const innerWire = innerTag & 0x7;
          if (innerWire === PROTO_WIRE_VARINT) {
            const [v, next] = readProtobufVarint(formatIdBytes, inner);
            if (innerField === 1) {
              itag = v;
            }

            inner = next;
          } else if (innerWire === PROTO_WIRE_LENGTH_DELIMITED) {
            const [l, after] = readProtobufVarint(formatIdBytes, inner);
            inner = after + l;
          } else {
            break;
          }
        }
      }

      offset = afterLength + length;
    } else {
      break;
    }
  }
  return { headerId, itag, sequenceNumber };
}

interface SabrRunResult {
  videoBytes: Uint8Array;
  audioBytes: Uint8Array;
}

export async function firefoxSabrSingleFetch({ url, body, signal }: {
  url: string;
  body: Uint8Array;
  signal: AbortSignal;
}): Promise<{ response: Uint8Array; itags: { video: number[]; audio: number[] } }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/x-protobuf",
      "accept": "application/vnd.yt-ump"
    },
    body: body as BodyInit,
    credentials: "include",
    signal
  });
  if (!response.ok) {
    throw new Error(`SABR HTTP ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return {
    response: new Uint8Array(buffer),
    itags: extractPreferredFormatItagsFromBody(Array.from(body))
  };
}

export function assembleMediaByFormat({ umpBody, expectedVideoItag, expectedAudioItag }: {
  umpBody: Uint8Array;
  expectedVideoItag: number;
  expectedAudioItag: number;
}): SabrRunResult {
  const parts = parseUmpResponse(umpBody);
  const headerIdToItag = new Map<number, number>();
  const headerIdToSequence = new Map<number, number>();
  const mediaByHeaderId = new Map<number, Uint8Array[]>();

  for (const part of parts) {
    if (part.type === UMP_PART_MEDIA_HEADER) {
      const header = parseMediaHeader(part.data);
      if (header) {
        headerIdToItag.set(header.headerId, header.itag);
        headerIdToSequence.set(header.headerId, header.sequenceNumber);
      }
    } else if (part.type === UMP_PART_MEDIA) {
      // MEDIA part's first varint is headerId, rest is bytes.
      const [headerId, afterHeaderId] = readProtobufVarint(part.data, 0);
      if (headerId < 0) {
        continue;
      }

      const chunk = part.data.subarray(afterHeaderId);
      const existing = mediaByHeaderId.get(headerId) ?? [];
      existing.push(chunk);
      mediaByHeaderId.set(headerId, existing);
    }
  }

  function concatForItag(targetItag: number) {
    const entries: Array<{ sequence: number; bytes: Uint8Array[] }> = [];
    for (const [headerId, chunks] of mediaByHeaderId) {
      if (headerIdToItag.get(headerId) === targetItag) {
        entries.push({
          sequence: headerIdToSequence.get(headerId) ?? 0,
          bytes: chunks
        });
      }
    }

    entries.sort((a, b) => a.sequence - b.sequence);
    const total = entries.reduce((sum, e) => sum + e.bytes.reduce((s, b) => s + b.byteLength, 0), 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const entry of entries) {
      for (const chunk of entry.bytes) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }
    return out;
  }

  return {
    videoBytes: concatForItag(expectedVideoItag),
    audioBytes: concatForItag(expectedAudioItag)
  };
}
