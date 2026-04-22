/**
 * Standalone unit test for firefox-sabr body splicing (playbackCookie +
 * playerTimeMs + bufferedRanges). Doesn't touch the browser — constructs
 * synthetic proto-encoded bodies, runs the splices, and re-parses to assert
 * fields end up correctly encoded.
 *
 * Usage: pnpx tsx scripts/test-splice-sabr.ts
 */
import {
  spliceBodyWithPlaybackCookie,
  spliceBodyWithState
} from "@/lib/youtube/firefox-sabr";

// ── Proto wire writers (minimal, local to the test) ──────────────────────────

function writeVarint(bytes: number[], value: number) {
  let v = value;
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v);
}

function writeTag(bytes: number[], fieldNumber: number, wireType: number) {
  writeVarint(bytes, (fieldNumber << 3) | wireType);
}

function writeLengthDelimited(bytes: number[], fieldNumber: number, payload: number[]) {
  writeTag(bytes, fieldNumber, 2);
  writeVarint(bytes, payload.length);
  for (const b of payload) {
    bytes.push(b);
  }
}

function writeVarintField(bytes: number[], fieldNumber: number, value: number) {
  writeTag(bytes, fieldNumber, 0);
  writeVarint(bytes, value);
}

// ── Proto wire reader (to parse the spliced output) ──────────────────────────

function readVarint(buf: Uint8Array, offset: number): [number, number] {
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

interface ParsedField {
  fieldNumber: number;
  wireType: number;
  value: number | Uint8Array;
}

function parseMessage(buf: Uint8Array): ParsedField[] {
  const fields: ParsedField[] = [];
  let offset = 0;
  while (offset < buf.byteLength) {
    const [tag, afterTag] = readVarint(buf, offset);
    if (tag < 0) {
      break;
    }

    const fieldNumber = tag >> 3;
    const wireType = tag & 0x7;
    offset = afterTag;
    if (wireType === 0) {
      const [v, next] = readVarint(buf, offset);
      fields.push({ fieldNumber, wireType, value: v });
      offset = next;
    } else if (wireType === 2) {
      const [len, afterLen] = readVarint(buf, offset);
      fields.push({ fieldNumber, wireType, value: buf.subarray(afterLen, afterLen + len) });
      offset = afterLen + len;
    } else {
      break;
    }
  }

  return fields;
}

// ── Test utilities ───────────────────────────────────────────────────────────

let testsPassed = 0;
let testsFailed = 0;

function assertEq<T>(label: string, got: T, want: T) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) {
    testsPassed++;
    console.log(`  ✓ ${label}`);
  } else {
    testsFailed++;
    console.log(`  ✗ ${label}`);
    console.log(`    got: ${JSON.stringify(got)}`);
    console.log(`    want: ${JSON.stringify(want)}`);
  }
}

// ── Tests: spliceBodyWithState ───────────────────────────────────────────────

// ── Proto field numbers (match firefox-sabr.ts + googlevideo protos) ─────────

const ABS_PLAYER_TIME_MS = 28;
const TOP_BUFFERED_RANGES = 3;
const RANGE_FORMAT_ID = 1;
const RANGE_START_TIME_MS = 2;
const RANGE_DURATION_MS = 3;
const RANGE_START_SEGMENT_INDEX = 4;
const RANGE_END_SEGMENT_INDEX = 5;

function buildBaseBody({ initialPlayerTimeMs, includeRanges }: {
  initialPlayerTimeMs: number;
  includeRanges: boolean;
}): Uint8Array {
  // clientAbrState (field 1) sub-message with:
  //   ABS_PLAYER_TIME_MS = initialPlayerTimeMs
  //   field 2 (some other varint) = 100  [simulate extra fields we must preserve]
  const abs: number[] = [];
  writeVarintField(abs, 2, 100);
  writeVarintField(abs, ABS_PLAYER_TIME_MS, initialPlayerTimeMs);

  const body: number[] = [];
  writeLengthDelimited(body, 1, abs);

  // streamerContext (field 19): empty sub-message
  const streamerCtx: number[] = [];
  writeLengthDelimited(body, 19, streamerCtx);

  if (includeRanges) {
    // two bufferedRanges entries at top-level field TOP_BUFFERED_RANGES
    const range1: number[] = [];
    const fmtId1: number[] = [];
    writeVarintField(fmtId1, 1, 140);
    writeLengthDelimited(range1, RANGE_FORMAT_ID, fmtId1);
    writeVarintField(range1, RANGE_START_TIME_MS, 0);
    writeVarintField(range1, RANGE_DURATION_MS, 2000);
    writeVarintField(range1, RANGE_START_SEGMENT_INDEX, 1);
    writeVarintField(range1, RANGE_END_SEGMENT_INDEX, 1);
    writeLengthDelimited(body, TOP_BUFFERED_RANGES, range1);

    const range2: number[] = [];
    const fmtId2: number[] = [];
    writeVarintField(fmtId2, 1, 251);
    writeLengthDelimited(range2, RANGE_FORMAT_ID, fmtId2);
    writeVarintField(range2, RANGE_START_TIME_MS, 0);
    writeVarintField(range2, RANGE_DURATION_MS, 2000);
    writeVarintField(range2, RANGE_START_SEGMENT_INDEX, 1);
    writeVarintField(range2, RANGE_END_SEGMENT_INDEX, 1);
    writeLengthDelimited(body, TOP_BUFFERED_RANGES, range2);
  }

  return new Uint8Array(body);
}

function test_spliceBodyWithState_replacesPlayerTimeMs() {
  console.log("test: spliceBodyWithState replaces playerTimeMs");
  const body = buildBaseBody({ initialPlayerTimeMs: 0, includeRanges: false });
  const out = spliceBodyWithState({
    body,
    playerTimeMs: 5000,
    ranges: []
  });
  const top = parseMessage(out);
  const abs = top.find(f => f.fieldNumber === 1);
  if (!abs || !(abs.value instanceof Uint8Array)) {
    assertEq("clientAbrState (field 1) present", false, true);
    return;
  }

  const inner = parseMessage(abs.value);
  const playerTime = inner.find(f => f.fieldNumber === ABS_PLAYER_TIME_MS);
  const preserved = inner.find(f => f.fieldNumber === 2);
  assertEq("playerTimeMs replaced", playerTime?.value, 5000);
  assertEq("sibling field 2 preserved", preserved?.value, 100);
}

function test_spliceBodyWithState_stripsExistingRanges() {
  console.log("test: spliceBodyWithState strips existing ranges then appends new ones");
  const body = buildBaseBody({ initialPlayerTimeMs: 0, includeRanges: true });
  const out = spliceBodyWithState({
    body,
    playerTimeMs: 3000,
    ranges: [{
      itag: 251,
      startMs: 0,
      durationMs: 3000,
      startSegmentIndex: 1,
      endSegmentIndex: 2
    }]
  });
  const top = parseMessage(out);
  const ranges = top.filter(f => f.fieldNumber === TOP_BUFFERED_RANGES);
  assertEq("exactly one bufferedRange remains", ranges.length, 1);
  if (ranges.length !== 1) {
    return;
  }

  const inner = parseMessage(ranges[0].value as Uint8Array);
  const fmtId = inner.find(f => f.fieldNumber === RANGE_FORMAT_ID);
  const start = inner.find(f => f.fieldNumber === RANGE_START_TIME_MS);
  const dur = inner.find(f => f.fieldNumber === RANGE_DURATION_MS);
  const startSeg = inner.find(f => f.fieldNumber === RANGE_START_SEGMENT_INDEX);
  const endSeg = inner.find(f => f.fieldNumber === RANGE_END_SEGMENT_INDEX);
  assertEq("range.startMs", start?.value, 0);
  assertEq("range.durationMs", dur?.value, 3000);
  assertEq("range.startSegmentIndex", startSeg?.value, 1);
  assertEq("range.endSegmentIndex", endSeg?.value, 2);
  if (fmtId && fmtId.value instanceof Uint8Array) {
    const fmtInner = parseMessage(fmtId.value);
    const itag = fmtInner.find(f => f.fieldNumber === 1);
    assertEq("range.formatId.itag", itag?.value, 251);
  } else {
    assertEq("range.formatId present", false, true);
  }
}

function test_spliceBodyWithState_multipleRanges() {
  console.log("test: spliceBodyWithState writes multiple ranges");
  const body = buildBaseBody({ initialPlayerTimeMs: 0, includeRanges: false });
  const out = spliceBodyWithState({
    body,
    playerTimeMs: 0,
    ranges: [
      { itag: 140, startMs: 0, durationMs: 5000, startSegmentIndex: 1, endSegmentIndex: 1 },
      { itag: 251, startMs: 0, durationMs: 4000, startSegmentIndex: 1, endSegmentIndex: 1 }
    ]
  });
  const top = parseMessage(out);
  const ranges = top.filter(f => f.fieldNumber === TOP_BUFFERED_RANGES);
  assertEq("two bufferedRanges written", ranges.length, 2);
}

// ── Tests: spliceBodyWithPlaybackCookie ──────────────────────────────────────

function test_spliceBodyWithPlaybackCookie_addsIfMissing() {
  console.log("test: spliceBodyWithPlaybackCookie adds cookie when streamerContext has none");
  const body = buildBaseBody({ initialPlayerTimeMs: 0, includeRanges: false });
  const cookie = new Uint8Array([0x08, 0x2a]); // arbitrary 2-byte proto
  const out = spliceBodyWithPlaybackCookie(body, cookie);
  const top = parseMessage(out);
  const streamerCtx = top.find(f => f.fieldNumber === 19);
  if (!streamerCtx || !(streamerCtx.value instanceof Uint8Array)) {
    assertEq("streamerContext present", false, true);
    return;
  }

  const inner = parseMessage(streamerCtx.value);
  const cookieField = inner.find(f => f.fieldNumber === 3);
  if (!cookieField || !(cookieField.value instanceof Uint8Array)) {
    assertEq("playbackCookie (field 3) present", false, true);
    return;
  }

  assertEq("cookie bytes match",
    Array.from(cookieField.value),
    Array.from(cookie));
}

function test_spliceBodyWithPlaybackCookie_replacesIfPresent() {
  console.log("test: spliceBodyWithPlaybackCookie replaces cookie when streamerContext has one");
  // Build body with an existing cookie (field 3 in streamerContext)
  const abs: number[] = [];
  writeVarintField(abs, ABS_PLAYER_TIME_MS, 0);
  const streamerCtx: number[] = [];
  writeLengthDelimited(streamerCtx, 3, [0x01, 0x02, 0x03]); // old cookie
  writeVarintField(streamerCtx, 2, 1); // other field to preserve
  const body: number[] = [];
  writeLengthDelimited(body, 1, abs);
  writeLengthDelimited(body, 19, streamerCtx);

  const newCookie = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
  const out = spliceBodyWithPlaybackCookie(new Uint8Array(body), newCookie);
  const top = parseMessage(out);
  const ctx = top.find(f => f.fieldNumber === 19);
  if (!ctx || !(ctx.value instanceof Uint8Array)) {
    assertEq("streamerContext present", false, true);
    return;
  }

  const inner = parseMessage(ctx.value);
  const cookies = inner.filter(f => f.fieldNumber === 3);
  assertEq("exactly one playbackCookie remains", cookies.length, 1);
  if (cookies.length === 1 && cookies[0].value instanceof Uint8Array) {
    assertEq("cookie bytes replaced",
      Array.from(cookies[0].value),
      Array.from(newCookie));
  }

  const preserved = inner.find(f => f.fieldNumber === 2);
  assertEq("sibling field 2 preserved", preserved?.value, 1);
}

// ── Run ──────────────────────────────────────────────────────────────────────

test_spliceBodyWithState_replacesPlayerTimeMs();
test_spliceBodyWithState_stripsExistingRanges();
test_spliceBodyWithState_multipleRanges();
test_spliceBodyWithPlaybackCookie_addsIfMissing();
test_spliceBodyWithPlaybackCookie_replacesIfPresent();

console.log(`\n${testsPassed} passed, ${testsFailed} failed`);
if (testsFailed > 0) {
  process.exit(1);
}
