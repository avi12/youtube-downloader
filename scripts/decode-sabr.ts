// Compare clientAbrState between YouTube and our request
import { readFileSync } from "fs";

function decodeVarint(buffer, offset) {
  let value = 0n, shift = 0n;
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
  return { value, offset };
}

function decodeProtobuf(buffer, offset = 0, end = buffer.byteLength) {
  const fields = {};
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

    let value;
    if (wireType === 0) {
      const v = decodeVarint(buffer, offset);
      offset = v.offset;
      value = v.value;
    } else if (wireType === 1) {
      value = buffer.slice(offset, offset + 8);
      offset += 8;
    } else if (wireType === 2) {
      const len = decodeVarint(buffer, offset);
      offset = len.offset;
      value = buffer.slice(offset, offset + Number(len.value));
      offset += Number(len.value);
    } else if (wireType === 5) {
      value = buffer.slice(offset, offset + 4);
      offset += 4;
    } else {
      break;
    }

    if (!fields[fieldNumber]) {
      fields[fieldNumber] = [];
    }

    fields[fieldNumber].push({ wireType, value });
  }
  return fields;
}

function loadRequest(path) {
  const b64 = readFileSync(path, "utf8");
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

const ytBytes = loadRequest("/tmp/yt_sabr_request.b64");
const ourBytes = loadRequest("/tmp/our_sabr_request.b64");

const ytFields = decodeProtobuf(ytBytes);
const ourFields = decodeProtobuf(ourBytes);

// Decode clientAbrState (field 1)
console.log("=== ClientAbrState (field 1) ===");
const ytAbr = ytFields[1] ? decodeProtobuf(ytFields[1][0].value) : {};
const ourAbr = ourFields[1] ? decodeProtobuf(ourFields[1][0].value) : {};

console.log("\nYouTube clientAbrState fields:");
for (const [num, entries] of Object.entries(ytAbr).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  const val = entries[0];
  const desc = val.wireType === 0 ? String(val.value) :
    val.wireType === 2 ? `msg(${val.value.byteLength}b)` :
      val.wireType === 5 ? `f32` : `wire${val.wireType}`;
  console.log(`  field ${num}: ${desc}`);
}

console.log("\nOur clientAbrState fields:");
for (const [num, entries] of Object.entries(ourAbr).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  const val = entries[0];
  const desc = val.wireType === 0 ? String(val.value) :
    val.wireType === 2 ? `msg(${val.value.byteLength}b)` :
      val.wireType === 5 ? `f32` : `wire${val.wireType}`;
  console.log(`  field ${num}: ${desc}`);
}

// Show what YouTube has that we don't
const ytAbrFields = new Set(Object.keys(ytAbr));
const ourAbrFields = new Set(Object.keys(ourAbr));
const missing = [...ytAbrFields].filter(f => !ourAbrFields.has(f));
console.log("\nFields in YouTube but not ours:", missing.map(f => `field ${f}`).join(", "));

// Decode StreamerContext (field 19)
console.log("\n=== StreamerContext (field 19) ===");
const ytCtx = ytFields[19] ? decodeProtobuf(ytFields[19][0].value) : {};
const ourCtx = ourFields[19] ? decodeProtobuf(ourFields[19][0].value) : {};

console.log("\nYouTube streamerContext fields:");
for (const [num, entries] of Object.entries(ytCtx).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  const val = entries[0];
  const desc = val.wireType === 0 ? String(val.value) :
    val.wireType === 2 ? `msg(${val.value.byteLength}b)` :
      val.wireType === 5 ? `f32` : `wire${val.wireType}`;
  console.log(`  field ${num}: ${desc}${entries.length > 1 ? ` (x${entries.length})` : ""}`);
}

console.log("\nOur streamerContext fields:");
for (const [num, entries] of Object.entries(ourCtx).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  const val = entries[0];
  const desc = val.wireType === 0 ? String(val.value) :
    val.wireType === 2 ? `msg(${val.value.byteLength}b)` :
      val.wireType === 5 ? `f32` : `wire${val.wireType}`;
  console.log(`  field ${num}: ${desc}${entries.length > 1 ? ` (x${entries.length})` : ""}`);
}

// Decode StreamerContext sub-fields
console.log("\n=== StreamerContext detail ===");

if (ytCtx[1]) {
  const ci = decodeProtobuf(ytCtx[1][0].value);
  console.log("YT ClientInfo (ctx.1):");
  for (const [n, e] of Object.entries(ci).sort((a, b)=>parseInt(a[0]) - parseInt(b[0]))) {
    const v = e[0];
    if (v.wireType === 0) {
      console.log("  field", n, ":", String(v.value));
    } else if (v.wireType === 2) {
      try {
        console.log("  field", n, ":", JSON.stringify(new TextDecoder().decode(v.value)));
      } catch {
        console.log("  field", n, ": bytes(" + v.value.byteLength + ")");
      }
    }
  }
}

if (ytCtx[2]) {
  console.log("YT ctx.2 (playbackCookie?):", ytCtx[2][0].value.byteLength, "bytes");
}

if (ytCtx[3]) {
  console.log("YT ctx.3 (poToken/field4?):", ytCtx[3][0].value.byteLength, "bytes");
  // Try decode as sub-message
  const sub = decodeProtobuf(ytCtx[3][0].value);
  console.log("  sub-fields:", Object.keys(sub));
}

if (ourCtx[1]) {
  const ci = decodeProtobuf(ourCtx[1][0].value);
  console.log("\nOur ClientInfo (ctx.1):");
  for (const [n, e] of Object.entries(ci).sort((a, b)=>parseInt(a[0]) - parseInt(b[0]))) {
    const v = e[0];
    if (v.wireType === 0) {
      console.log("  field", n, ":", String(v.value));
    } else if (v.wireType === 2) {
      try {
        console.log("  field", n, ":", JSON.stringify(new TextDecoder().decode(v.value)));
      } catch {
        console.log("  field", n, ": bytes(" + v.value.byteLength + ")");
      }
    }
  }
}
