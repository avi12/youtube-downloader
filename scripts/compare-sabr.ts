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
    const byte = buffer[offset++];
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
    const fieldNum = tag.value >> FIELD_NUM_SHIFT;
    const wireType = tag.value & WIRE_TYPE_MASK;
    if (fieldNum === 0) {
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
      const len = decodeVarint(buffer, offset);
      offset = len.offset;
      field = {
        wireType: WIRE_TYPE_LENGTH_DELIMITED,
        value: buffer.slice(offset, offset + len.value)
      };
      offset += len.value;
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

    if (!fields[fieldNum]) {
      fields[fieldNum] = [];
    }

    fields[fieldNum].push(field);
  }
  return fields;
}

function loadB64(path: string) {
  return Uint8Array.from(atob(readFileSync(path, "utf8")), char => char.charCodeAt(0));
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

function printFields(label: string, buf: Uint8Array, indent = "") {
  console.log(`${indent}${label} (${buf.byteLength}b):`);
  const fields = decodeProtobuf(buf);
  for (const [fieldNum, entries] of Object.entries(fields).sort(byNumericKey)) {
    for (const entry of entries) {
      console.log(`${indent}  field ${fieldNum}: ${fieldDesc(entry)}`);
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

const ytField1 = ytFields[FIELD_CLIENT_ABR_STATE]?.[0];
if (ytField1?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  printFields("YouTube", ytField1.value, "  ");
}

const ourField1 = ourFields[FIELD_CLIENT_ABR_STATE]?.[0];
if (ourField1?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  printFields("Ours", ourField1.value, "  ");
}

// Compare field 19 (streamerContext)
console.log("\n=== streamerContext (field 19) ===");

const ytField19 = ytFields[FIELD_STREAMER_CONTEXT]?.[0];
if (ytField19?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  const ytCtx = printFields("YouTube", ytField19.value, "  ");
  const ytCtxField1 = ytCtx[STREAMER_CTX_CLIENT_INFO]?.[0];
  if (ytCtxField1?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    printFields("  clientInfo", ytCtxField1.value, "    ");
  }

  const ytCtxField2 = ytCtx[STREAMER_CTX_PO_TOKEN]?.[0];
  if (ytCtxField2?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    console.log("  PO Token:", ytCtxField2.value.byteLength, "bytes");
  }

  const ytCtxField3 = ytCtx[STREAMER_CTX_PLAYBACK_COOKIE]?.[0];
  if (ytCtxField3?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    console.log("  playbackCookie:", ytCtxField3.value.byteLength, "bytes");
  }
}

const ourField19 = ourFields[FIELD_STREAMER_CONTEXT]?.[0];
if (ourField19?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
  const ourCtx = printFields("Ours", ourField19.value, "  ");
  const ourCtxField1 = ourCtx[STREAMER_CTX_CLIENT_INFO]?.[0];
  if (ourCtxField1?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    printFields("  clientInfo", ourCtxField1.value, "    ");
  }

  const ourCtxField2 = ourCtx[STREAMER_CTX_PO_TOKEN]?.[0];
  if (ourCtxField2?.wireType === WIRE_TYPE_LENGTH_DELIMITED) {
    console.log("  PO Token:", ourCtxField2.value.byteLength, "bytes");
  } else {
    console.log("  NO PO Token");
  }
}
