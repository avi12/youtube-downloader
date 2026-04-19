// Analyze the SABR request that returned 200 to find the minimal required fields
import { readFileSync } from "node:fs";

const SABR_REQUEST_PATH = "/tmp/fresh_sabr_request.b64";
const CLIENT_ABR_STATE_FIELD = "1";
const STREAMER_CONTEXT_FIELD = "19";
const CLIENT_INFO_FIELD = "1";
const PO_TOKEN_FIELD = "2";

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
  return parseInt(entryA[0]) - parseInt(entryB[0]);
}

function readVarint(buf: Uint8Array, offset: number) {
  let value = 0;
  let shift = 0;
  while (offset < buf.byteLength) {
    const byte = buf[offset++];
    value |= (byte & 0x7f) << shift;

    if (!(byte & 0x80)) {
      break;
    }

    shift += 7;
  }
  return {
    value: value >>> 0,
    offset
  };
}

function decodeFields(buf: Uint8Array): Record<number, ProtobufField[]> {
  const fields: Record<number, ProtobufField[]> = {};
  let offset = 0;
  while (offset < buf.byteLength) {
    const tag = readVarint(buf, offset);
    offset = tag.offset;
    const fieldNum = tag.value >> 3;
    const wireType = tag.value & 7;
    if (fieldNum === 0) {
      break;
    }

    let field: ProtobufField;
    if (wireType === 0) {
      const varintResult = readVarint(buf, offset);
      offset = varintResult.offset;
      field = {
        type: "varint",
        value: varintResult.value
      };
    } else if (wireType === 2) {
      const len = readVarint(buf, offset);
      offset = len.offset;
      field = {
        type: "bytes",
        data: buf.slice(offset, offset + len.value)
      };
      offset += len.value;
    } else if (wireType === 5) {
      field = {
        type: "f32",
        data: buf.slice(offset, offset + 4)
      };
      offset += 4;
    } else if (wireType === 1) {
      field = {
        type: "f64",
        data: buf.slice(offset, offset + 8)
      };
      offset += 8;
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

// Load the fresh initial request that returned 200
const b64 = readFileSync(SABR_REQUEST_PATH, "utf8");
const bytes = Uint8Array.from(atob(b64), char => char.charCodeAt(0));

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
