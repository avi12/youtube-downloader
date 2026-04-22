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
const UMP_PART_NEXT_REQUEST_POLICY = 35;
const UMP_PART_FORMAT_INITIALIZATION_METADATA = 42;

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
  startMs: number;
  durationMs: number;
}

// Field numbers from googlevideo's media_header.proto:
//   1 headerId, 2 videoId, 3 itag, 4 lmt, 9 sequenceNumber,
//   11 startMs, 12 durationMs, 13 formatId, 15 timeRange
function parseMediaHeader(data: Uint8Array): MediaHeader | null {
  let headerId = 0;
  let itag = 0;
  let sequenceNumber = 0;
  let startMs = 0;
  let durationMs = 0;
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
        itag = value;
      } else if (fieldNumber === 9) {
        sequenceNumber = value;
      } else if (fieldNumber === 11) {
        startMs = value;
      } else if (fieldNumber === 12) {
        durationMs = value;
      }

      offset = nextOffset;
    } else if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
      const [length, afterLength] = readProtobufVarint(data, offset);
      if (length < 0 || afterLength + length > data.byteLength) {
        return null;
      }

      if (fieldNumber === 13 && itag === 0) {
        // formatId sub-message, preferred source of itag when not set inline
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
  return { headerId, itag, sequenceNumber, startMs, durationMs };
}

export interface SabrSegment {
  itag: number;
  sequenceNumber: number;
  startMs: number;
  durationMs: number;
  bytes: Uint8Array;
}

interface SabrRunResult {
  videoBytes: Uint8Array;
  audioBytes: Uint8Array;
  playbackCookie: Uint8Array | null;
  segments: SabrSegment[];
}

/**
 * NEXT_REQUEST_POLICY (part 35) is a protobuf message. Its field 2 is the
 * PlaybackCookie (length-delimited sub-message), which YT expects us to
 * echo back in the next request's StreamerContext.playbackCookie to
 * advance the stream.
 */
function extractPlaybackCookieFromNextRequestPolicy(data: Uint8Array): Uint8Array | null {
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
      const [, next] = readProtobufVarint(data, offset);
      offset = next;
    } else if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
      const [length, afterLength] = readProtobufVarint(data, offset);
      if (length < 0 || afterLength + length > data.byteLength) {
        return null;
      }

      if (fieldNumber === 2) {
        return data.subarray(afterLength, afterLength + length);
      }

      offset = afterLength + length;
    } else {
      break;
    }
  }
  return null;
}

/**
 * Encode a length-delimited protobuf field (tag varint + length varint + bytes).
 */
function encodeLengthDelimited(fieldNumber: number, bytes: Uint8Array): Uint8Array {
  function varintLength(value: number) {
    let len = 0;
    let v = value;
    do {
      len++;
      v >>>= 7;
    } while (v > 0);
    return len;
  }

  function writeVarint(out: number[], value: number) {
    let v = value;
    while (v >= 0x80) {
      out.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    out.push(v);
  }

  const tag = (fieldNumber << 3) | 2;
  const header: number[] = [];
  writeVarint(header, tag);
  writeVarint(header, bytes.byteLength);
  const out = new Uint8Array(header.length + bytes.byteLength);
  out.set(header, 0);
  out.set(bytes, header.length);
  return out;
}

const FIELD_STREAMER_CONTEXT = 19;
const FIELD_PLAYBACK_COOKIE = 3;

/**
 * Takes a VideoPlaybackAbrRequest body and a PlaybackCookie (raw bytes),
 * and returns a new body with the streamerContext.playbackCookie replaced
 * (or added if absent). Done at the byte level to avoid depending on a
 * full protobuf writer.
 */
export function spliceBodyWithPlaybackCookie(body: Uint8Array, cookieBytes: Uint8Array): Uint8Array {
  // Pass 1: find streamerContext field at top level.
  let offset = 0;
  let streamerCtxStart = -1;
  let streamerCtxLenOffset = -1;
  let streamerCtxPayloadStart = -1;
  let streamerCtxPayloadLen = -1;
  let tagTotalLen = 0;
  while (offset < body.byteLength) {
    const tagStart = offset;
    const [tag, afterTag] = readProtobufVarint(body, offset);
    if (tag < 0) {
      break;
    }

    offset = afterTag;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;
    if (wireType === PROTO_WIRE_VARINT) {
      const [, next] = readProtobufVarint(body, offset);
      offset = next;
      continue;
    }

    if (wireType !== PROTO_WIRE_LENGTH_DELIMITED) {
      break;
    }

    const lenOffset = offset;
    const [length, afterLength] = readProtobufVarint(body, offset);
    if (length < 0) {
      break;
    }

    if (fieldNumber === FIELD_STREAMER_CONTEXT) {
      streamerCtxStart = tagStart;
      streamerCtxLenOffset = lenOffset;
      streamerCtxPayloadStart = afterLength;
      streamerCtxPayloadLen = length;
      tagTotalLen = afterLength - tagStart;
      break;
    }

    offset = afterLength + length;
  }

  if (streamerCtxStart < 0 || streamerCtxPayloadStart < 0) {
    return body;
  }

  // Pass 2: within streamerContext, find field 3 (playbackCookie) if any.
  const ctx = body.subarray(streamerCtxPayloadStart, streamerCtxPayloadStart + streamerCtxPayloadLen);
  const newCookieField = encodeLengthDelimited(FIELD_PLAYBACK_COOKIE, cookieBytes);
  let innerOffset = 0;
  let existingCookieStart = -1;
  let existingCookieTotalLen = 0;
  while (innerOffset < ctx.byteLength) {
    const innerTagStart = innerOffset;
    const [innerTag, afterInnerTag] = readProtobufVarint(ctx, innerOffset);
    if (innerTag < 0) {
      break;
    }

    innerOffset = afterInnerTag;
    const fieldNumber = innerTag >> 3;
    const wireType = innerTag & 0x7;
    if (wireType === PROTO_WIRE_VARINT) {
      const [, next] = readProtobufVarint(ctx, innerOffset);
      innerOffset = next;
      continue;
    }

    if (wireType !== PROTO_WIRE_LENGTH_DELIMITED) {
      break;
    }

    const [length, afterLength] = readProtobufVarint(ctx, innerOffset);
    if (length < 0) {
      break;
    }

    if (fieldNumber === FIELD_PLAYBACK_COOKIE) {
      existingCookieStart = innerTagStart;
      existingCookieTotalLen = afterLength + length - innerTagStart;
      break;
    }

    innerOffset = afterLength + length;
  }

  // Rebuild streamerContext bytes (existing cookie removed if any, then appended with new).
  let ctxWithoutCookie: Uint8Array;
  if (existingCookieStart >= 0) {
    const before = ctx.subarray(0, existingCookieStart);
    const after = ctx.subarray(existingCookieStart + existingCookieTotalLen);
    ctxWithoutCookie = new Uint8Array(before.byteLength + after.byteLength);
    ctxWithoutCookie.set(before, 0);
    ctxWithoutCookie.set(after, before.byteLength);
  } else {
    ctxWithoutCookie = ctx;
  }

  const newCtx = new Uint8Array(ctxWithoutCookie.byteLength + newCookieField.byteLength);
  newCtx.set(ctxWithoutCookie, 0);
  newCtx.set(newCookieField, ctxWithoutCookie.byteLength);

  // Re-encode the streamerContext length-delimited field.
  const newStreamerField = encodeLengthDelimited(FIELD_STREAMER_CONTEXT, newCtx);

  // Splice it back into the body.
  const before = body.subarray(0, streamerCtxStart);
  const after = body.subarray(streamerCtxPayloadStart + streamerCtxPayloadLen);
  const out = new Uint8Array(before.byteLength + newStreamerField.byteLength + after.byteLength);
  out.set(before, 0);
  out.set(newStreamerField, before.byteLength);
  out.set(after, before.byteLength + newStreamerField.byteLength);
  return out;
}

const FIELD_CLIENT_ABR_STATE = 1;
const FIELD_BUFFERED_RANGES = 23;
const CLIENT_ABR_STATE_PLAYER_TIME_MS = 15;
const BUFFERED_RANGE_FORMAT_ID = 1;
const BUFFERED_RANGE_START_TIME_MS = 3;
const BUFFERED_RANGE_DURATION_MS = 4;
const BUFFERED_RANGE_START_SEGMENT_INDEX = 5;
const BUFFERED_RANGE_END_SEGMENT_INDEX = 6;
const FORMAT_ID_ITAG = 1;

function writeVarintToArray(out: number[], value: number) {
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function encodeFormatId(itag: number): Uint8Array {
  const payload: number[] = [];
  writeVarintToArray(payload, (FORMAT_ID_ITAG << 3) | 0);
  writeVarintToArray(payload, itag);
  return encodeLengthDelimited(BUFFERED_RANGE_FORMAT_ID, new Uint8Array(payload));
}

function encodeBufferedRange(range: { itag: number; startMs: number; durationMs: number; startSegmentIndex: number; endSegmentIndex: number }): Uint8Array {
  const payload: number[] = [];
  const formatIdField = encodeFormatId(range.itag);
  payload.push(...formatIdField);
  writeVarintToArray(payload, (BUFFERED_RANGE_START_TIME_MS << 3) | 0);
  writeVarintToArray(payload, range.startMs);
  writeVarintToArray(payload, (BUFFERED_RANGE_DURATION_MS << 3) | 0);
  writeVarintToArray(payload, range.durationMs);
  writeVarintToArray(payload, (BUFFERED_RANGE_START_SEGMENT_INDEX << 3) | 0);
  writeVarintToArray(payload, range.startSegmentIndex);
  writeVarintToArray(payload, (BUFFERED_RANGE_END_SEGMENT_INDEX << 3) | 0);
  writeVarintToArray(payload, range.endSegmentIndex);
  return encodeLengthDelimited(FIELD_BUFFERED_RANGES, new Uint8Array(payload));
}

/**
 * Finds a top-level length-delimited field in the body and returns its
 * [tagStart, payloadStart, payloadLen] or null if absent.
 */
function findTopLevelLengthDelimitedField(body: Uint8Array, targetField: number):
  { tagStart: number; payloadStart: number; payloadLen: number } | null {
  let offset = 0;
  while (offset < body.byteLength) {
    const tagStart = offset;
    const [tag, afterTag] = readProtobufVarint(body, offset);
    if (tag < 0) {
      break;
    }

    offset = afterTag;
    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;
    if (wireType === PROTO_WIRE_VARINT) {
      const [, next] = readProtobufVarint(body, offset);
      offset = next;
      continue;
    }

    if (wireType === 1) {
      offset += 8;
      continue;
    }

    if (wireType === 5) {
      offset += 4;
      continue;
    }

    if (wireType !== PROTO_WIRE_LENGTH_DELIMITED) {
      break;
    }

    const [length, afterLength] = readProtobufVarint(body, offset);
    if (length < 0) {
      break;
    }

    if (fieldNumber === targetField) {
      return {
        tagStart,
        payloadStart: afterLength,
        payloadLen: length
      };
    }

    offset = afterLength + length;
  }
  return null;
}

/**
 * Updates clientAbrState.playerTimeMs (field 1 > field 15) and appends
 * BufferedRange entries (field 23) to a VideoPlaybackAbrRequest body.
 * Removes all existing BufferedRange entries first. Does nothing if body
 * can't be parsed.
 */
export function spliceBodyWithState({ body, playerTimeMs, ranges }: {
  body: Uint8Array;
  playerTimeMs: number;
  ranges: Array<{ itag: number; startMs: number; durationMs: number; startSegmentIndex: number; endSegmentIndex: number }>;
}): Uint8Array {
  let working = body;

  // Step 1: update clientAbrState.playerTimeMs
  const absField = findTopLevelLengthDelimitedField(working, FIELD_CLIENT_ABR_STATE);
  if (absField) {
    const abs = working.subarray(absField.payloadStart, absField.payloadStart + absField.payloadLen);
    // Strip any existing playerTimeMs field then append the new one.
    let inner = 0;
    const kept: number[] = [];
    while (inner < abs.byteLength) {
      const tagStart = inner;
      const [tag, afterTag] = readProtobufVarint(abs, inner);
      if (tag < 0) {
        break;
      }

      const fieldNumber = tag >> 3;
      const wireType = tag & 0x7;
      let fieldEnd: number;
      if (wireType === PROTO_WIRE_VARINT) {
        const [, next] = readProtobufVarint(abs, afterTag);
        fieldEnd = next;
      } else if (wireType === 1) {
        fieldEnd = afterTag + 8;
      } else if (wireType === 5) {
        fieldEnd = afterTag + 4;
      } else if (wireType === PROTO_WIRE_LENGTH_DELIMITED) {
        const [len, afterLen] = readProtobufVarint(abs, afterTag);
        fieldEnd = afterLen + len;
      } else {
        break;
      }

      if (fieldNumber !== CLIENT_ABR_STATE_PLAYER_TIME_MS) {
        for (let i = tagStart; i < fieldEnd; i++) {
          kept.push(abs[i]);
        }
      }

      inner = fieldEnd;
    }

    writeVarintToArray(kept, (CLIENT_ABR_STATE_PLAYER_TIME_MS << 3) | 0);
    writeVarintToArray(kept, playerTimeMs);
    const newAbs = new Uint8Array(kept);
    const newAbsField = encodeLengthDelimited(FIELD_CLIENT_ABR_STATE, newAbs);

    const before = working.subarray(0, absField.tagStart);
    const after = working.subarray(absField.payloadStart + absField.payloadLen);
    const next = new Uint8Array(before.byteLength + newAbsField.byteLength + after.byteLength);
    next.set(before, 0);
    next.set(newAbsField, before.byteLength);
    next.set(after, before.byteLength + newAbsField.byteLength);
    working = next;
  }

  // Step 2: remove existing BufferedRange entries (top-level field 23) then append fresh ones.
  // Strip all occurrences in a loop (repeated field).
  while (true) {
    const br = findTopLevelLengthDelimitedField(working, FIELD_BUFFERED_RANGES);
    if (!br) {
      break;
    }

    const totalLen = (br.payloadStart - br.tagStart) + br.payloadLen;
    const before = working.subarray(0, br.tagStart);
    const after = working.subarray(br.tagStart + totalLen);
    const next = new Uint8Array(before.byteLength + after.byteLength);
    next.set(before, 0);
    next.set(after, before.byteLength);
    working = next;
  }

  // Append new BufferedRange entries at end (order-agnostic for top-level).
  const rangeEncodings = ranges.map(encodeBufferedRange);
  const totalRangeLen = rangeEncodings.reduce((s, r) => s + r.byteLength, 0);
  const withRanges = new Uint8Array(working.byteLength + totalRangeLen);
  withRanges.set(working, 0);
  let appendAt = working.byteLength;
  for (const r of rangeEncodings) {
    withRanges.set(r, appendAt);
    appendAt += r.byteLength;
  }
  return withRanges;
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
  const headerById = new Map<number, MediaHeader>();
  const mediaByHeaderId = new Map<number, Uint8Array[]>();
  let playbackCookie: Uint8Array | null = null;

  for (const part of parts) {
    if (part.type === UMP_PART_MEDIA_HEADER) {
      const header = parseMediaHeader(part.data);
      if (header) {
        headerById.set(header.headerId, header);
      }
    } else if (part.type === UMP_PART_MEDIA) {
      const [headerId, afterHeaderId] = readProtobufVarint(part.data, 0);
      if (headerId < 0) {
        continue;
      }

      const chunk = part.data.subarray(afterHeaderId);
      const existing = mediaByHeaderId.get(headerId) ?? [];
      existing.push(chunk);
      mediaByHeaderId.set(headerId, existing);
    } else if (part.type === UMP_PART_NEXT_REQUEST_POLICY) {
      playbackCookie = extractPlaybackCookieFromNextRequestPolicy(part.data);
    }
  }

  const segments: SabrSegment[] = [];
  for (const [headerId, chunks] of mediaByHeaderId) {
    const header = headerById.get(headerId);
    if (!header) {
      continue;
    }

    const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    segments.push({
      itag: header.itag,
      sequenceNumber: header.sequenceNumber,
      startMs: header.startMs,
      durationMs: header.durationMs,
      bytes
    });
  }

  function concatForItag(targetItag: number) {
    const filtered = segments.filter(s => s.itag === targetItag);
    filtered.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const total = filtered.reduce((sum, s) => sum + s.bytes.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const s of filtered) {
      out.set(s.bytes, offset);
      offset += s.bytes.byteLength;
    }
    return out;
  }

  return {
    videoBytes: concatForItag(expectedVideoItag),
    audioBytes: concatForItag(expectedAudioItag),
    playbackCookie,
    segments
  };
}
