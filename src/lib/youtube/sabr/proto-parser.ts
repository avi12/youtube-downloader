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

function readVarint(bytes: Uint8Array, offsetIn: number) {
  let value = 0;
  let shift = 0;
  let offset = offsetIn;
  while (offset < bytes.byteLength) {
    const byte = bytes[offset];
    offset++;
    value |= (byte & VARINT_DATA_BITS_MASK) << shift;

    if ((byte & VARINT_CONTINUATION_BIT) === 0) {
      break;
    }

    shift += VARINT_BITS_PER_BYTE;
  }
  return {
    value: value >>> 0,
    offset
  };
}

function parseStreamerContext(contextData: Uint8Array) {
  let contextOffset = 0;
  while (contextOffset < contextData.byteLength) {
    const contextTag = readVarint(contextData, contextOffset);
    contextOffset = contextTag.offset;
    const contextField = contextTag.value >> PROTO_FIELD_NUMBER_SHIFT;
    const contextWire = contextTag.value & PROTO_WIRE_TYPE_MASK;
    if (contextWire === WIRE_TYPE_VARINT) {
      contextOffset = readVarint(contextData, contextOffset).offset;
      continue;
    }

    if (contextWire !== WIRE_TYPE_LENGTH_DELIMITED) {
      break;
    }

    const contextLength = readVarint(contextData, contextOffset);
    contextOffset = contextLength.offset;

    if (contextField === FIELD_PO_TOKEN && contextLength.value > 0) {
      const poTokenBytes = contextData.subarray(contextOffset, contextOffset + contextLength.value);
      return btoa(String.fromCharCode(...poTokenBytes));
    }

    contextOffset += contextLength.value;
  }

  return null;
}

export function extractPoTokenFromBody(body: number[]) {
  const bytes = new Uint8Array(body);
  let offset = 0;

  while (offset < bytes.byteLength) {
    const tag = readVarint(bytes, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> PROTO_FIELD_NUMBER_SHIFT;
    const wireType = tag.value & PROTO_WIRE_TYPE_MASK;
    if (wireType === WIRE_TYPE_VARINT) {
      offset = readVarint(bytes, offset).offset;
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

    const length = readVarint(bytes, offset);
    offset = length.offset;

    if (fieldNumber === FIELD_STREAMER_CONTEXT) {
      const poToken = parseStreamerContext(bytes.subarray(offset, offset + length.value));
      if (poToken) {
        return poToken;
      }
    }

    offset += length.value;
  }

  return null;
}
