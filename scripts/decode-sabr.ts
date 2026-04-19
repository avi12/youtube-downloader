// Compare clientAbrState between YouTube and our request
import { readFileSync } from "node:fs";

const YT_SABR_REQUEST_PATH = "/tmp/yt_sabr_request.b64";
const OUR_SABR_REQUEST_PATH = "/tmp/our_sabr_request.b64";

type VarintField = {
  wireType: 0;
  value: bigint;
};
type BytesField = {
  wireType: 2;
  value: Uint8Array;
};
type Fixed64Field = {
  wireType: 1;
  value: Uint8Array;
};
type Fixed32Field = {
  wireType: 5;
  value: Uint8Array;
};
type ProtobufField = VarintField | BytesField | Fixed64Field | Fixed32Field;

function byNumericKey(entryA: [string, ProtobufField[]], entryB: [string, ProtobufField[]]) {
  return parseInt(entryA[0]) - parseInt(entryB[0]);
}

function decodeVarint(buffer: Uint8Array, offset: number) {
  let value = 0n;
  let shift = 0n;
  while (offset < buffer.byteLength) {
    const byte = buffer[offset++];
    value |= BigInt(byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      break;
    }

    shift += 7n;

    if (shift > 63n) {
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
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (fieldNumber === 0) {
      break;
    }

    let field: ProtobufField;
    if (wireType === 0) {
      const varintResult = decodeVarint(buffer, offset);
      offset = varintResult.offset;
      field = {
        wireType: 0,
        value: varintResult.value
      };
    } else if (wireType === 1) {
      field = {
        wireType: 1,
        value: buffer.slice(offset, offset + 8)
      };
      offset += 8;
    } else if (wireType === 2) {
      const len = decodeVarint(buffer, offset);
      offset = len.offset;
      field = {
        wireType: 2,
        value: buffer.slice(offset, offset + Number(len.value))
      };
      offset += Number(len.value);
    } else if (wireType === 5) {
      field = {
        wireType: 5,
        value: buffer.slice(offset, offset + 4)
      };
      offset += 4;
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
  const b64 = readFileSync(path, "utf8");
  return Uint8Array.from(atob(b64), char => char.charCodeAt(0));
}

function fieldDesc(field: ProtobufField) {
  if (field.wireType === 0) {
    return String(field.value);
  }

  if (field.wireType === 2) {
    return `msg(${field.value.byteLength}b)`;
  }

  if (field.wireType === 5) {
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
const ytField1 = ytFields[1]?.[0];
const ytAbr = ytField1?.wireType === 2 ? decodeProtobuf(ytField1.value) : {};
const ourField1 = ourFields[1]?.[0];
const ourAbr = ourField1?.wireType === 2 ? decodeProtobuf(ourField1.value) : {};

console.log("\nYouTube clientAbrState fields:");
for (const [num, entries] of Object.entries(ytAbr).sort(byNumericKey)) {
  console.log(`  field ${num}: ${fieldDesc(entries[0])}`);
}

console.log("\nOur clientAbrState fields:");
for (const [num, entries] of Object.entries(ourAbr).sort(byNumericKey)) {
  console.log(`  field ${num}: ${fieldDesc(entries[0])}`);
}

// Show what YouTube has that we don't
const ytAbrFields = new Set(Object.keys(ytAbr));
const ourAbrFields = new Set(Object.keys(ourAbr));
const missing = [...ytAbrFields].filter(fieldKey => !ourAbrFields.has(fieldKey));
console.log("\nFields in YouTube but not ours:", missing.map(fieldKey => `field ${fieldKey}`).join(", "));

// Decode StreamerContext (field 19)
console.log("\n=== StreamerContext (field 19) ===");
const ytField19 = ytFields[19]?.[0];
const ytCtx = ytField19?.wireType === 2 ? decodeProtobuf(ytField19.value) : {};
const ourField19 = ourFields[19]?.[0];
const ourCtx = ourField19?.wireType === 2 ? decodeProtobuf(ourField19.value) : {};

console.log("\nYouTube streamerContext fields:");
for (const [num, entries] of Object.entries(ytCtx).sort(byNumericKey)) {
  const suffix = entries.length > 1 ? ` (x${entries.length})` : "";
  console.log(`  field ${num}: ${fieldDesc(entries[0])}${suffix}`);
}

console.log("\nOur streamerContext fields:");
for (const [num, entries] of Object.entries(ourCtx).sort(byNumericKey)) {
  const suffix = entries.length > 1 ? ` (x${entries.length})` : "";
  console.log(`  field ${num}: ${fieldDesc(entries[0])}${suffix}`);
}

// Decode StreamerContext sub-fields
console.log("\n=== StreamerContext detail ===");

const ytCtxField1 = ytCtx[1]?.[0];
if (ytCtxField1?.wireType === 2) {
  const clientInfo = decodeProtobuf(ytCtxField1.value);
  console.log("YT ClientInfo (ctx.1):");
  for (const [num, entries] of Object.entries(clientInfo).sort(byNumericKey)) {
    const entry = entries[0];
    if (entry.wireType === 0) {
      console.log("  field", num, ":", String(entry.value));
    } else if (entry.wireType === 2) {
      try {
        console.log("  field", num, ":", JSON.stringify(new TextDecoder().decode(entry.value)));
      } catch {
        console.log("  field", num, ": bytes(" + entry.value.byteLength + ")");
      }
    }
  }
}

const ytCtxField2 = ytCtx[2]?.[0];
if (ytCtxField2?.wireType === 2) {
  console.log("YT ctx.2 (playbackCookie?):", ytCtxField2.value.byteLength, "bytes");
}

const ytCtxField3 = ytCtx[3]?.[0];
if (ytCtxField3?.wireType === 2) {
  console.log("YT ctx.3 (poToken/field4?):", ytCtxField3.value.byteLength, "bytes");
  const sub = decodeProtobuf(ytCtxField3.value);
  console.log("  sub-fields:", Object.keys(sub));
}

const ourCtxField1 = ourCtx[1]?.[0];
if (ourCtxField1?.wireType === 2) {
  const clientInfo = decodeProtobuf(ourCtxField1.value);
  console.log("\nOur ClientInfo (ctx.1):");
  for (const [num, entries] of Object.entries(clientInfo).sort(byNumericKey)) {
    const entry = entries[0];
    if (entry.wireType === 0) {
      console.log("  field", num, ":", String(entry.value));
    } else if (entry.wireType === 2) {
      try {
        console.log("  field", num, ":", JSON.stringify(new TextDecoder().decode(entry.value)));
      } catch {
        console.log("  field", num, ": bytes(" + entry.value.byteLength + ")");
      }
    }
  }
}
