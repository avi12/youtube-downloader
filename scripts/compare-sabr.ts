import { readFileSync } from "node:fs";

const YT_SABR_REQUEST_PATH = "/tmp/fresh_sabr_request.b64";
const OUR_SABR_REQUEST_PATH = "/tmp/our_sabr_v2.b64";

const WIRE_TYPE_VARINT = 0 as const;
const WIRE_TYPE_FIXED64 = 1 as const;
const WIRE_TYPE_LENGTH_DELIMITED = 2 as const;
const WIRE_TYPE_FIXED32 = 5 as const;

const VARINT_DATA_MASK = 0x7f;
const VARINT_CONTINUE_MASK = 0x80;
const WIRE_TYPE_MASK = 0x7;
const VARINT_SHIFT_BITS = 7;
const FIELD_NUM_SHIFT = 3;
const FIXED64_BYTE_SIZE = 8;
const FIXED32_BYTE_SIZE = 4;

const FIELD_CLIENT_ABR_STATE = 1;
const FIELD_STREAMER_CONTEXT = 19;
const STREAMER_CTX_CLIENT_INFO = 1;
const STREAMER_CTX_PO_TOKEN = 2;
const STREAMER_CTX_PLAYBACK_COOKIE = 3;

type VarintField = {
  wireType: typeof WIRE_TYPE_VARINT;
  value: number;
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
  let value = 0;
  let shift = 0;
  while (offset < buffer.byteLength) {
    const byte = buffer[offset];
    offset++;
    value |= (byte & VARINT_DATA_MASK) << shift;

    if ((byte & VARINT_CONTINUE_MASK) === 0) {
      break;
    }

    shift += VARINT_SHIFT_BITS;
  }
  return {
    value: value >>> 0,
    offset
  };
}

function decodeProtobuf(buffer: Uint8Array): Record<number, ProtobufField[]> {
  const fields: Record<number, ProtobufField[]> = {};
  let offset = 0;
  while (offset < buffer.byteLength) {
    const tag = decodeVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> FIELD_NUM_SHIFT;
    const wireType = tag.value & WIRE_TYPE_MASK;
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
    } else if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const length = decodeVarint(buffer, offset);
      offset = length.offset;
      field = {
        wireType: WIRE_TYPE_LENGTH_DELIMITED,
        value: buffer.slice(offset, offset + length.value)
      };
      offset += length.value;
    } else if (wireType === WIRE_TYPE_FIXED64) {
      field = {
        wireType: WIRE_TYPE_FIXED64,
        value: buffer.slice(offset, offset + FIXED64_BYTE_SIZE)
      };
      offset += FIXED64_BYTE_SIZE;
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

function loadB64(path: string) {
  return Uint8Array.from(atob(readFileSync(path, "utf8")), character => character.charCodeAt(0));
}

function fieldDesc(field: ProtobufField) {
  if (field.wireType === WIRE_TYPE_VARINT) {
    return String(field.value);
  }

  if (field.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    return `bytes(${field.value.byteLength})`;
  }

  if (field.wireType === WIRE_TYPE_FIXED32) {
    return "f32";
  }

  return `wire${field.wireType}`;
}

function printFields(label: string, buffer: Uint8Array, indent = "") {
  console.log(`${indent}${label} (${buffer.byteLength}b):`);
  const fields = decodeProtobuf(buffer);
  for (const [fieldNumber, entries] of Object.entries(fields).sort(byNumericKey)) {
    for (const entry of entries) {
      console.log(`${indent}  field ${fieldNumber}: ${fieldDesc(entry)}`);
    }
  }
  return fields;
}

const ytBytes = loadB64(YT_SABR_REQUEST_PATH);
const ourBytes = loadB64(OUR_SABR_REQUEST_PATH);

console.log("=== TOP LEVEL ===");
const ytFields = printFields("YouTube", ytBytes);
const ourFields = printFields("Ours", ourBytes);

// Compare field 1 (clientAbrState)
console.log("\n=== clientAbrState (field 1) ===");

const ytAbrStateField = ytFields[FIELD_CLIENT_ABR_STATE]?.[0];
if (ytAbrStateField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  printFields("YouTube", ytAbrStateField.value, "  ");
}

const ourAbrStateField = ourFields[FIELD_CLIENT_ABR_STATE]?.[0];
if (ourAbrStateField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  printFields("Ours", ourAbrStateField.value, "  ");
}

// Compare field 19 (streamerContext)
console.log("\n=== streamerContext (field 19) ===");

const ytStreamerContextField = ytFields[FIELD_STREAMER_CONTEXT]?.[0];
if (ytStreamerContextField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  const ytStreamerContext = printFields("YouTube", ytStreamerContextField.value, "  ");
  const ytClientInfoField = ytStreamerContext[STREAMER_CTX_CLIENT_INFO]?.[0];
  if (ytClientInfoField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    printFields("  clientInfo", ytClientInfoField.value, "    ");
  }

  const ytPoTokenField = ytStreamerContext[STREAMER_CTX_PO_TOKEN]?.[0];
  if (ytPoTokenField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    console.log("  PO Token:", ytPoTokenField.value.byteLength, "bytes");
  }

  const ytPlaybackCookieField = ytStreamerContext[STREAMER_CTX_PLAYBACK_COOKIE]?.[0];
  if (ytPlaybackCookieField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    console.log("  playbackCookie:", ytPlaybackCookieField.value.byteLength, "bytes");
  }
}

const ourStreamerContextField = ourFields[FIELD_STREAMER_CONTEXT]?.[0];
if (ourStreamerContextField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  const ourStreamerContext = printFields("Ours", ourStreamerContextField.value, "  ");
  const ourClientInfoField = ourStreamerContext[STREAMER_CTX_CLIENT_INFO]?.[0];
  if (ourClientInfoField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    printFields("  clientInfo", ourClientInfoField.value, "    ");
  }

  const ourPoTokenField = ourStreamerContext[STREAMER_CTX_PO_TOKEN]?.[0];
  if (ourPoTokenField?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    console.log("  PO Token:", ourPoTokenField.value.byteLength, "bytes");
  } else {
    console.log("  NO PO Token");
  }
}
