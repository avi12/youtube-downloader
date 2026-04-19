import { readFileSync } from "fs";

function decodeVarint(buffer, offset) {
  let value = 0, shift = 0;
  while (offset < buffer.byteLength) {
    const byte = buffer[offset++];
    value |= (byte & 0x7f) << shift;

    if ((byte & 0x80) === 0) {
      break;
    }

    shift += 7;
  }
  return { value: value >>> 0, offset };
}

function decodeProtobuf(buffer) {
  const fields = {};
  let offset = 0;
  while (offset < buffer.byteLength) {
    const tag = decodeVarint(buffer, offset);
    offset = tag.offset;
    const fn = tag.value >> 3, wt = tag.value & 0x7;
    if (fn === 0) {
      break;
    }

    let value;
    if (wt === 0) {
      const v = decodeVarint(buffer, offset); offset = v.offset; value = v.value;
    } else if (wt === 2) {
      const len = decodeVarint(buffer, offset); offset = len.offset; value = buffer.slice(offset, offset + len.value); offset += len.value;
    } else if (wt === 1) {
      value = buffer.slice(offset, offset + 8); offset += 8;
    } else if (wt === 5) {
      value = buffer.slice(offset, offset + 4); offset += 4;
    } else {
      break;
    }

    if (!fields[fn]) {
      fields[fn] = [];
    }

    fields[fn].push({ wt, value });
  }
  return fields;
}

function loadB64(path) {
  return Uint8Array.from(atob(readFileSync(path, "utf8")), c => c.charCodeAt(0));
}

function printFields(label, bytes, indent = "") {
  console.log(`${indent}${label} (${bytes.byteLength}b):`);
  const fields = decodeProtobuf(bytes);
  for (const [n, entries] of Object.entries(fields).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    for (const e of entries) {
      const desc = e.wt === 0 ? String(e.value) :
        e.wt === 2 ? `bytes(${e.value.byteLength})` :
          e.wt === 5 ? "f32" : `wire${e.wt}`;
      console.log(`${indent}  field ${n}: ${desc}`);
    }
  }
  return fields;
}

const ytBytes = loadB64("/tmp/fresh_sabr_request.b64");
const ourBytes = loadB64("/tmp/our_sabr_v2.b64");

console.log("=== TOP LEVEL ===");
const ytFields = printFields("YouTube", ytBytes);
const ourFields = printFields("Ours", ourBytes);

// Compare field 1 (clientAbrState)
console.log("\n=== clientAbrState (field 1) ===");

if (ytFields[1]) {
  printFields("YouTube", ytFields[1][0].value, "  ");
}

if (ourFields[1]) {
  printFields("Ours", ourFields[1][0].value, "  ");
}

// Compare field 19 (streamerContext)
console.log("\n=== streamerContext (field 19) ===");

if (ytFields[19]) {
  const ytCtx = printFields("YouTube", ytFields[19][0].value, "  ");
  if (ytCtx[1]) {
    printFields("  clientInfo", ytCtx[1][0].value, "    ");
  }

  if (ytCtx[2]) {
    console.log("  PO Token:", ytCtx[2][0].value.byteLength, "bytes");
  }

  if (ytCtx[3]) {
    console.log("  playbackCookie:", ytCtx[3][0].value.byteLength, "bytes");
  }
}

if (ourFields[19]) {
  const ourCtx = printFields("Ours", ourFields[19][0].value, "  ");
  if (ourCtx[1]) {
    printFields("  clientInfo", ourCtx[1][0].value, "    ");
  }

  if (ourCtx[2]) {
    console.log("  PO Token:", ourCtx[2][0].value.byteLength, "bytes");
  } else {
    console.log("  NO PO Token");
  }
}
