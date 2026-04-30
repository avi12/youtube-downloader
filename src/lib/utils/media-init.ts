function readFmp4BoxType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function readFmp4BoxSize(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}

function findFmp4InitEnd(bytes: Uint8Array): number {
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    const size = readFmp4BoxSize(bytes, offset);
    if (size < 8) {
      break;
    }

    if (readFmp4BoxType(bytes, offset) === "moof") {
      return offset;
    }

    offset += size;
  }
  return bytes.length;
}

function findWebmClusterOffset(bytes: Uint8Array): number {
  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0x1f && bytes[i + 1] === 0x43 && bytes[i + 2] === 0xb6 && bytes[i + 3] === 0x75) {
      return i;
    }
  }
  return bytes.length;
}

function hasFmp4Init(bytes: Uint8Array): boolean {
  if (bytes.length < 8) {
    return false;
  }

  return readFmp4BoxType(bytes, 0) !== "moof";
}

function hasWebmInit(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

function concatBytes(head: Uint8Array, tail: Uint8Array): Uint8Array {
  const out = new Uint8Array(head.length + tail.length);
  out.set(head);
  out.set(tail, head.length);
  return out;
}

export function extractInit(bytes: Uint8Array, mimeType: string): Uint8Array | undefined {
  if (bytes.length === 0) {
    return undefined;
  }

  const isWebm = mimeType.includes("webm") || mimeType.includes("opus");
  if (isWebm) {
    if (!hasWebmInit(bytes)) {
      return undefined;
    }

    const end = findWebmClusterOffset(bytes);
    return end > 0 ? bytes.subarray(0, end) : undefined;
  }

  if (!hasFmp4Init(bytes)) {
    return undefined;
  }

  const end = findFmp4InitEnd(bytes);
  return end > 0 ? bytes.subarray(0, end) : undefined;
}

export function prependInitIfMissing(bytes: Uint8Array, init: Uint8Array, mimeType: string): Uint8Array {
  if (bytes.length === 0) {
    return bytes;
  }

  const isWebm = mimeType.includes("webm") || mimeType.includes("opus");
  const alreadyHasInit = isWebm ? hasWebmInit(bytes) : hasFmp4Init(bytes);
  if (alreadyHasInit) {
    return bytes;
  }

  return concatBytes(init, bytes);
}
