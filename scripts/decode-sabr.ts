// Compare clientAbrState between YouTube and our request
import { readFileSync } from "node:fs";

const YT_SABR_REQUEST_PATH = "/tmp/yt_sabr_request.b64";
const OUR_SABR_REQUEST_PATH = "/tmp/our_sabr_request.b64";

const VARINT_DATA_MASK = 0x7f;
const VARINT_CONTINUE_MASK = 0x80;
const VARINT_SHIFT_BITS = 7n;
const VARINT_MAX_SHIFT_BITS = 63n;
const FIELD_NUM_SHIFT = 3n;
const WIRE_TYPE_MASK = 7n;
const WIRE_TYPE_VARINT = 0 as const;
const WIRE_TYPE_FIXED64 = 1 as const;
const WIRE_TYPE_LENGTH_DELIMITED = 2 as const;
const WIRE_TYPE_FIXED32 = 5 as const;
const FIXED64_BYTE_SIZE = 8;
const FIXED32_BYTE_SIZE = 4;
const FIELD_CLIENT_ABR_STATE = 1;
const FIELD_STREAMER_CONTEXT = 19;
const STREAMER_CTX_CLIENT_INFO = 1;
const STREAMER_CTX_PLAYBACK_COOKIE = 2;
const STREAMER_CTX_PO_TOKEN = 3;

type VarintField = {
  wireType: typeof WIRE_TYPE_VARINT;
  value: bigint;
};
type BytesField = {
  wireType: typeof WIRE_TYPE_LENGTH_DELIMITED;
  value: Uint8Array;
};
type Fixed64Field = {
  wireType: typeof WIRE_TYPE_FIXED64;
  value: Uint8Array;
};
type Fixed32Field = {
  wireType: typeof WIRE_TYPE_FIXED32;
  value: Uint8Array;
};
type ProtobufField = VarintField | BytesField | Fixed64Field | Fixed32Field;

function byNumericKey(entryA: [string, ProtobufField[]], entryB: [string, ProtobufField[]]) {
  return parseInt(entryA[0], 10) - parseInt(entryB[0], 10);
}

function decodeVarint(buffer: Uint8Array, offset: number) {
  let value = 0n;
  let shift = 0n;
  while (offset < buffer.byteLength) {
    const byte = buffer[offset];
    offset++;
    value |= BigInt(byte & VARINT_DATA_MASK) << shift;

    if ((byte & VARINT_CONTINUE_MASK) === 0) {
      break;
    }

    shift += VARINT_SHIFT_BITS;

    if (shift > VARINT_MAX_SHIFT_BITS) {
      break;
    }
  }
  return {
    value,
    offset
  };
}

function decodeProtobuf(buffer: Uint8Array, offset = 0, end = buffer.byteLength): Record<number, ProtobufField[]> {
  const fields: Record<number, ProtobufField[]> = {};
  while (offset < end) {
    const tag = decodeVarint(buffer, offset);
    if (tag.offset >= end) {
      break;
    }

    offset = tag.offset;
    const fieldNumber = Number(tag.value >> FIELD_NUM_SHIFT);
    const wireType = Number(tag.value & WIRE_TYPE_MASK);
    if (fieldNumber === 0) {
      break;
    }

    let field: ProtobufField;
    if (wireType === WIRE_TYPE_VARINT) {
      const varintResult = decodeVarint(buffer, offset);
      offset = varintResult.offset;
      field = {
        wireType: WIRE_TYPE_VARINT,
        value: varintResult.value
      };
    } else if (wireType === WIRE_TYPE_FIXED64) {
      field = {
        wireType: WIRE_TYPE_FIXED64,
        value: buffer.slice(offset, offset + FIXED64_BYTE_SIZE)
      };
      offset += FIXED64_BYTE_SIZE;
    } else if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const length = decodeVarint(buffer, offset);
      offset = length.offset;
      field = {
        wireType: WIRE_TYPE_LENGTH_DELIMITED,
        value: buffer.slice(offset, offset + Number(length.value))
      };
      offset += Number(length.value);
    } else if (wireType === WIRE_TYPE_FIXED32) {
      field = {
        wireType: WIRE_TYPE_FIXED32,
        value: buffer.slice(offset, offset + FIXED32_BYTE_SIZE)
      };
      offset += FIXED32_BYTE_SIZE;
    } else {
      break;
    }

    if (!fields[fieldNumber]) {
      fields[fieldNumber] = [];
    }

    fields[fieldNumber].push(field);
  }
  return fields;
}

function loadRequest(path: string) {
  const base64 = readFileSync(path, "utf8");
  return Uint8Array.from(atob(base64), character => character.charCodeAt(0));
}

function printClientInfo(label: string, buffer: Uint8Array) {
  const clientInfo = decodeProtobuf(buffer);
  console.log(label);
  for (const [fieldNumber, entries] of Object.entries(clientInfo).sort(byNumericKey)) {
    const entry = entries[0];
    if (entry.wireType === WIRE_TYPE_VARINT) {
      console.log("  field", fieldNumber, ":", String(entry.value));
    } else if (entry.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      try {
        console.log("  field", fieldNumber, ":", JSON.stringify(new TextDecoder().decode(entry.value)));
      } catch {
        console.log("  field", fieldNumber, ": bytes(" + entry.value.byteLength + ")");
      }
    }
  }
}

function fieldDesc(field: ProtobufField) {
  if (field.wireType === WIRE_TYPE_VARINT) {
    return String(field.value);
  }

  if (field.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    return `msg(${field.value.byteLength}b)`;
  }

  if (field.wireType === WIRE_TYPE_FIXED32) {
    return "f32";
  }

  return `wire${field.wireType}`;
}

const ytBytes = loadRequest(YT_SABR_REQUEST_PATH);
const ourBytes = loadRequest(OUR_SABR_REQUEST_PATH);

const ytFields = decodeProtobuf(ytBytes);
const ourFields = decodeProtobuf(ourBytes);

// Decode clientAbrState (field 1)
console.log("=== ClientAbrState (field 1) ===");
const ytAbrStateField = ytFields[FIELD_CLIENT_ABR_STATE]?.[0];
const ytAbrState =
  ytAbrStateField?.wireType === WIRE_TYPE_LENGTH_DELIMITED ? decodeProtobuf(ytAbrStateField.value) : {};
const ourAbrStateField = ourFields[FIELD_CLIENT_ABR_STATE]?.[0];
const ourAbrState =
  ourAbrStateField?.wireType === WIRE_TYPE_LENGTH_DELIMITED ? decodeProtobuf(ourAbrStateField.value) : {};

console.log("\nYouTube clientAbrState fields:");
for (const [fieldNumber, entries] of Object.entries(ytAbrState).sort(byNumericKey)) {
  console.log(`  field ${fieldNumber}: ${fieldDesc(entries[0])}`);
}

console.log("\nOur clientAbrState fields:");
for (const [fieldNumber, entries] of Object.entries(ourAbrState).sort(byNumericKey)) {
  console.log(`  field ${fieldNumber}: ${fieldDesc(entries[0])}`);
}

// Show what YouTube has that we don't
const ytAbrStateFieldKeys = new Set(Object.keys(ytAbrState));
const ourAbrStateFieldKeys = new Set(Object.keys(ourAbrState));
const missing = [...ytAbrStateFieldKeys].filter(fieldKey => !ourAbrStateFieldKeys.has(fieldKey));
console.log("\nFields in YouTube but not ours:", missing.map(fieldKey => `field ${fieldKey}`).join(", "));

// Decode StreamerContext (field 19)
console.log("\n=== StreamerContext (field 19) ===");
const ytStreamerContextField = ytFields[FIELD_STREAMER_CONTEXT]?.[0];
const ytStreamerContext =
  ytStreamerContextField?.wireType === WIRE_TYPE_LENGTH_DELIMITED
    ? decodeProtobuf(ytStreamerContextField.value)
    : {};
const ourStreamerContextField = ourFields[FIELD_STREAMER_CONTEXT]?.[0];
const ourStreamerContext =
  ourStreamerContextField?.wireType === WIRE_TYPE_LENGTH_DELIMITED
    ? decodeProtobuf(ourStreamerContextField.value)
    : {};

console.log("\nYouTube streamerContext fields:");
for (const [fieldNumber, entries] of Object.entries(ytStreamerContext).sort(byNumericKey)) {
  const suffix = entries.length > 1 ? ` (x${entries.length})` : "";
  console.log(`  field ${fieldNumber}: ${fieldDesc(entries[0])}${suffix}`);
}

console.log("\nOur streamerContext fields:");
for (const [fieldNumber, entries] of Object.entries(ourStreamerContext).sort(byNumericKey)) {
  const suffix = entries.length > 1 ? ` (x${entries.length})` : "";
  console.log(`  field ${fieldNumber}: ${fieldDesc(entries[0])}${suffix}`);
}

// Decode StreamerContext sub-fields
console.log("\n=== StreamerContext detail ===");

const ytClientInfoField = ytStreamerContext[STREAMER_CTX_CLIENT_INFO]?.[0];
if (ytClientInfoField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  printClientInfo("YT ClientInfo (ctx.1):", ytClientInfoField.value);
}

const ytPlaybackCookieField = ytStreamerContext[STREAMER_CTX_PLAYBACK_COOKIE]?.[0];
if (ytPlaybackCookieField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  console.log("YT ctx.2 (playbackCookie?):", ytPlaybackCookieField.value.byteLength, "bytes");
}

const ytPoTokenField = ytStreamerContext[STREAMER_CTX_PO_TOKEN]?.[0];
if (ytPoTokenField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  console.log("YT ctx.3 (poToken/field4?):", ytPoTokenField.value.byteLength, "bytes");
  const subFields = decodeProtobuf(ytPoTokenField.value);
  console.log("  sub-fields:", Object.keys(subFields));
}

const ourClientInfoField = ourStreamerContext[STREAMER_CTX_CLIENT_INFO]?.[0];
if (ourClientInfoField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  printClientInfo("\nOur ClientInfo (ctx.1):", ourClientInfoField.value);
}
