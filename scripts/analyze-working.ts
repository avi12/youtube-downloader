// Analyze the SABR request that returned 200 to find the minimal required fields
import { readFileSync } from "node:fs";

const SABR_REQUEST_PATH = "/tmp/fresh_sabr_request.b64";
const CLIENT_ABR_STATE_FIELD = "1";
const STREAMER_CONTEXT_FIELD = "19";
const CLIENT_INFO_FIELD = "1";
const PO_TOKEN_FIELD = "2";

const VARINT_DATA_MASK = 0x7f;
const VARINT_CONTINUE_MASK = 0x80;
const VARINT_SHIFT_BITS = 7;
const FIELD_NUM_SHIFT = 3;
const WIRE_TYPE_MASK = 7;
const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_FIXED64 = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_FIXED32 = 5;
const FIXED64_BYTE_SIZE = 8;
const FIXED32_BYTE_SIZE = 4;

type VarintField = {
  type: "varint";
  value: number;
};
type BytesField = {
  type: "bytes";
  data: Uint8Array;
};
type Fixed32Field = {
  type: "f32";
  data: Uint8Array;
};
type Fixed64Field = {
  type: "f64";
  data: Uint8Array;
};
type ProtobufField = VarintField | BytesField | Fixed32Field | Fixed64Field;

function byNumericKey(entryA: [string, ProtobufField[]], entryB: [string, ProtobufField[]]) {
  return parseInt(entryA[0], 10) - parseInt(entryB[0], 10);
}

function readVarint(buffer: Uint8Array, offset: number) {
  let value = 0;
  let shift = 0;
  while (offset < buffer.byteLength) {
    const byte = buffer[offset];
    offset++;
    value |= (byte & VARINT_DATA_MASK) << shift;

    if (!(byte & VARINT_CONTINUE_MASK)) {
      break;
    }

    shift += VARINT_SHIFT_BITS;
  }
  return {
    value: value >>> 0,
    offset
  };
}

function decodeFields(buffer: Uint8Array): Record<number, ProtobufField[]> {
  const fields: Record<number, ProtobufField[]> = {};
  let offset = 0;
  while (offset < buffer.byteLength) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> FIELD_NUM_SHIFT;
    const wireType = tag.value & WIRE_TYPE_MASK;
    if (fieldNumber === 0) {
      break;
    }

    let field: ProtobufField;
    if (wireType === WIRE_TYPE_VARINT) {
      const varintResult = readVarint(buffer, offset);
      offset = varintResult.offset;
      field = {
        type: "varint",
        value: varintResult.value
      };
    } else if (wireType === WIRE_TYPE_LENGTH_DELIMITED) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      field = {
        type: "bytes",
        data: buffer.slice(offset, offset + length.value)
      };
      offset += length.value;
    } else if (wireType === WIRE_TYPE_FIXED32) {
      field = {
        type: "f32",
        data: buffer.slice(offset, offset + FIXED32_BYTE_SIZE)
      };
      offset += FIXED32_BYTE_SIZE;
    } else if (wireType === WIRE_TYPE_FIXED64) {
      field = {
        type: "f64",
        data: buffer.slice(offset, offset + FIXED64_BYTE_SIZE)
      };
      offset += FIXED64_BYTE_SIZE;
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

// Load the fresh initial request that returned 200
const base64 = readFileSync(SABR_REQUEST_PATH, "utf8");
const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));

const top = decodeFields(bytes);
console.log("=== Top-level fields ===");
for (const [fieldNum, entries] of Object.entries(top)) {
  const entry = entries[0];
  const size = entry.type === "varint" ? entry.value : entry.data.byteLength;
  console.log(`field ${fieldNum}: ${entries.length}x, type=${entry.type}, size=${size}`);
}

// Field 1 = clientAbrState
console.log("\n=== clientAbrState (field 1) ===");
const abrEntry = top[CLIENT_ABR_STATE_FIELD][0];
const abr = abrEntry.type === "bytes" ? decodeFields(abrEntry.data) : {};
for (const [fieldNum, entries] of Object.entries(abr).sort(byNumericKey)) {
  const entry = entries[0];
  if (entry.type === "varint") {
    console.log(`  ${fieldNum}: ${entry.value}`);
  } else if (entry.type === "bytes") {
    console.log(`  ${fieldNum}: bytes(${entry.data.byteLength})`);
  } else if (entry.type === "f32") {
    const dataView = new DataView(entry.data.buffer, entry.data.byteOffset, 4);
    console.log(`  ${fieldNum}: f32(${dataView.getFloat32(0, true)})`);
  }
}

// Field 19 = streamerContext
console.log("\n=== streamerContext (field 19) ===");
const ctxEntry = top[STREAMER_CONTEXT_FIELD][0];
const ctx = ctxEntry.type === "bytes" ? decodeFields(ctxEntry.data) : {};
for (const [fieldNum, entries] of Object.entries(ctx).sort(byNumericKey)) {
  const entry = entries[0];
  const size = entry.type === "varint" ? entry.value : entry.data.byteLength;
  console.log(`  ${fieldNum}: ${entry.type}(${size})`);
}

// clientInfo
console.log("\n=== clientInfo (ctx field 1) ===");
const clientInfoEntry = ctx[CLIENT_INFO_FIELD]?.[0];
const clientInfo = clientInfoEntry?.type === "bytes" ? decodeFields(clientInfoEntry.data) : {};
for (const [fieldNum, entries] of Object.entries(clientInfo).sort(byNumericKey)) {
  const entry = entries[0];
  if (entry.type === "varint") {
    console.log(`  ${fieldNum}: ${entry.value}`);
  } else if (entry.type === "bytes") {
    try {
      console.log(`  ${fieldNum}: "${new TextDecoder().decode(entry.data)}"`);
    } catch {
      console.log(`  ${fieldNum}: bytes(${entry.data.byteLength})`);
    }
  }
}

// poToken
if (ctx[PO_TOKEN_FIELD]) {
  console.log("\n=== poToken (ctx field 2) ===");
  const poTokenEntry = ctx[PO_TOKEN_FIELD][0];
  if (poTokenEntry.type === "bytes") {
    console.log("  length:", poTokenEntry.data.byteLength);
    console.log("  hex:", Array.from(poTokenEntry.data).map(byte => byte.toString(16).padStart(2, "0")).join(" "));
    const poFields = decodeFields(poTokenEntry.data);
    for (const [fieldNum, entries] of Object.entries(poFields)) {
      const entry = entries[0];
      const size = entry.type === "varint" ? entry.value : entry.data.byteLength;
      console.log(`  field ${fieldNum}: ${entry.type}(${size})`);
    }
  }
}
