// Each scrub iframe captures a self-contained fMP4 [ftyp+moov]+[moof+mdat]*.
// All scrub tabs use the same itag, so their inits are equivalent — concat
// is just init from segment 0 + fragments-only from every segment after.
// This produces ONE valid fMP4 with monotonic tfdt timestamps, ready for a
// single ffmpeg mux pass with -c copy.

const BOX_HEADER_SIZE = 8;
const BOX_TYPE_MOOF = "moof";

function readBoxSize(bytes: Uint8Array, offset: number) {
  return (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readBoxType(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function findFirstMoofOffset(bytes: Uint8Array) {
  let offset = 0;
  while (offset + BOX_HEADER_SIZE <= bytes.length) {
    const boxSize = readBoxSize(bytes, offset);
    const boxType = readBoxType(bytes, offset);
    if (boxType === BOX_TYPE_MOOF) {
      return offset;
    }

    if (boxSize <= 0) {
      return -1;
    }

    offset += boxSize;
  }

  return -1;
}

export function concatFmp4Segments(segments: Uint8Array[]): Uint8Array {
  if (segments.length === 0) {
    return new Uint8Array();
  }

  if (segments.length === 1) {
    return segments[0];
  }

  const parts: Uint8Array[] = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const moofOffset = findFirstMoofOffset(segments[i]);
    if (moofOffset < 0) {
      console.warn(`[ytdl:fmp4-concat] segment ${i}: no moof box found, skipping`);
      continue;
    }

    parts.push(segments[i].subarray(moofOffset));
  }

  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }

  return out;
}
