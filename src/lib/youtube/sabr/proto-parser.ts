const VARINT_DATA_BITS_MASK = 0x7f;
const VARINT_CONTINUATION_BIT = 0x80;
const VARINT_BITS_PER_BYTE = 7;
const PROTO_FIELD_NUMBER_SHIFT = 3;
const PROTO_WIRE_TYPE_MASK = 0x7;
const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_64_BIT = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_32_BIT = 5;
const WIRE_64_BIT_BYTE_SIZE = 8;
const WIRE_32_BIT_BYTE_SIZE = 4;
const FIELD_STREAMER_CONTEXT = 19;
const FIELD_PO_TOKEN = 2;

function readVarint(buf: Uint8Array, off: number) {
  let value = 0;
  let shift = 0;
  while (off < buf.byteLength) {
    const byte = buf[off];
    off++;
    value |= (byte & VARINT_DATA_BITS_MASK) << shift;

    if ((byte & VARINT_CONTINUATION_BIT) === 0) {
      break;
    }

    shift += VARINT_BITS_PER_BYTE;
  }
  return {
    value: value >>> 0,
    offset: off
  };
}

function parseStreamerContext(ctxData: Uint8Array) {
  let ctxOffset = 0;
  while (ctxOffset < ctxData.byteLength) {
    const ctxTag = readVarint(ctxData, ctxOffset);
    ctxOffset = ctxTag.offset;
    const ctxField = ctxTag.value >> PROTO_FIELD_NUMBER_SHIFT;
    const ctxWire = ctxTag.value & PROTO_WIRE_TYPE_MASK;
    if (ctxWire === WIRE_TYPE_VARINT) {
      ctxOffset = readVarint(ctxData, ctxOffset).offset;
      continue;
    }

    if (ctxWire !== WIRE_TYPE_LENGTH_DELIMITED) {
      break;
    }

    const ctxLen = readVarint(ctxData, ctxOffset);
    ctxOffset = ctxLen.offset;

    if (ctxField === FIELD_PO_TOKEN && ctxLen.value > 0) {
      const poTokenBytes = ctxData.subarray(ctxOffset, ctxOffset + ctxLen.value);
      return btoa(String.fromCharCode(...poTokenBytes));
    }

    ctxOffset += ctxLen.value;
  }

  return null;
}

export function extractPoTokenFromBody(body: number[]) {
  const buf = new Uint8Array(body);
  let offset = 0;

  while (offset < buf.byteLength) {
    const tag = readVarint(buf, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> PROTO_FIELD_NUMBER_SHIFT;
    const wireType = tag.value & PROTO_WIRE_TYPE_MASK;
    if (wireType === WIRE_TYPE_VARINT) {
      offset = readVarint(buf, offset).offset;
      continue;
    }

    if (wireType === WIRE_TYPE_64_BIT) {
      offset += WIRE_64_BIT_BYTE_SIZE;
      continue;
    }

    if (wireType === WIRE_TYPE_32_BIT) {
      offset += WIRE_32_BIT_BYTE_SIZE;
      continue;
    }

    if (wireType !== WIRE_TYPE_LENGTH_DELIMITED) {
      break;
    }

    const len = readVarint(buf, offset);
    offset = len.offset;

    if (fieldNumber === FIELD_STREAMER_CONTEXT) {
      const poToken = parseStreamerContext(buf.subarray(offset, offset + len.value));
      if (poToken) {
        return poToken;
      }
    }

    offset += len.value;
  }

  return null;
}
