// Analyze the SABR request that returned 200 to find the minimal required fields
import { readFileSync } from "fs";

function readVarint(buf, off) {
  let v = 0, s = 0;
  while (off < buf.byteLength) {
    const b = buf[off++]; v |= (b & 0x7f) << s;

    if (!(b & 0x80)) {
      break;
    }

    s += 7;
  }
  return { value: v >>> 0, offset: off };
}

function decodeFields(buf) {
  const fields = {};
  let off = 0;
  while (off < buf.byteLength) {
    const tag = readVarint(buf, off); off = tag.offset;
    const fn = tag.value >> 3, wt = tag.value & 7;
    if (fn === 0) {
      break;
    }

    let value;
    if (wt === 0) {
      const v = readVarint(buf, off); off = v.offset; value = { type: "varint", value: v.value };
    } else if (wt === 2) {
      const len = readVarint(buf, off); off = len.offset; value = { type: "bytes", data: buf.slice(off, off + len.value) }; off += len.value;
    } else if (wt === 5) {
      value = { type: "f32", data: buf.slice(off, off + 4) }; off += 4;
    } else if (wt === 1) {
      value = { type: "f64", data: buf.slice(off, off + 8) }; off += 8;
    } else {
      break;
    }

    if (!fields[fn]) {
      fields[fn] = [];
    }

    fields[fn].push(value);
  }
  return fields;
}

// Load the fresh initial request that returned 200
const b64 = readFileSync("/tmp/fresh_sabr_request.b64", "utf8");
const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));

const top = decodeFields(bytes);
console.log("=== Top-level fields ===");
for (const [fn, entries] of Object.entries(top)) {
  console.log(`field ${fn}: ${entries.length}x, type=${entries[0].type}, size=${entries[0].data?.byteLength ?? entries[0].value}`);
}

// Field 1 = clientAbrState
console.log("\n=== clientAbrState (field 1) ===");
const abr = decodeFields(top["1"][0].data);
for (const [fn, entries] of Object.entries(abr).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  const e = entries[0];
  if (e.type === "varint") {
    console.log(`  ${fn}: ${e.value}`);
  } else if (e.type === "bytes") {
    console.log(`  ${fn}: bytes(${e.data.byteLength})`);
  } else if (e.type === "f32") {
    const dv = new DataView(e.data.buffer, e.data.byteOffset, 4);
    console.log(`  ${fn}: f32(${dv.getFloat32(0, true)})`);
  }
}

// Field 19 = streamerContext
console.log("\n=== streamerContext (field 19) ===");
const ctx = decodeFields(top["19"][0].data);
for (const [fn, entries] of Object.entries(ctx).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  const e = entries[0];
  console.log(`  ${fn}: ${e.type}(${e.data?.byteLength ?? e.value})`);
}

// clientInfo
console.log("\n=== clientInfo (ctx field 1) ===");
const ci = decodeFields(ctx["1"][0].data);
for (const [fn, entries] of Object.entries(ci).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
  const e = entries[0];
  if (e.type === "varint") {
    console.log(`  ${fn}: ${e.value}`);
  } else if (e.type === "bytes") {
    try {
      console.log(`  ${fn}: "${new TextDecoder().decode(e.data)}"`);
    } catch {
      console.log(`  ${fn}: bytes(${e.data.byteLength})`);
    }
  }
}

// poToken
if (ctx["2"]) {
  console.log("\n=== poToken (ctx field 2) ===");
  const po = ctx["2"][0].data;
  console.log("  length:", po.byteLength);
  console.log("  hex:", Array.from(po).map(b => b.toString(16).padStart(2, "0")).join(" "));
  // Decode as protobuf
  const poFields = decodeFields(po);
  for (const [fn, entries] of Object.entries(poFields)) {
    const e = entries[0];
    console.log(`  field ${fn}: ${e.type}(${e.data?.byteLength ?? e.value})`);
  }
}
