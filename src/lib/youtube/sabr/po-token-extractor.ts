import {
  PROTO_FIELD_NUMBER_SHIFT,
  PROTO_WIRE_TYPE_MASK,
  WIRE_TYPE_VARINT,
  WIRE_TYPE_64_BIT,
  WIRE_TYPE_LENGTH_DELIMITED,
  WIRE_TYPE_32_BIT,
  WIRE_64_BIT_BYTE_SIZE,
  WIRE_32_BIT_BYTE_SIZE,
  readVarint
} from "./proto-wire";

const FIELD_STREAMER_CONTEXT = 19;
const FIELD_PO_TOKEN = 2;

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

    const ctxFieldLength = readVarint(ctxData, ctxOffset);
    ctxOffset = ctxFieldLength.offset;

    if (ctxField === FIELD_PO_TOKEN && ctxFieldLength.value > 0) {
      const poTokenBytes = ctxData.subarray(ctxOffset, ctxOffset + ctxFieldLength.value);
      return btoa(String.fromCharCode(...poTokenBytes));
    }

    ctxOffset += ctxFieldLength.value;
  }
  return null;
}

export function extractPoTokenFromBody(body: number[]) {
  const buffer = new Uint8Array(body);
  let offset = 0;

  while (offset < buffer.byteLength) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >> PROTO_FIELD_NUMBER_SHIFT;
    const wireType = tag.value & PROTO_WIRE_TYPE_MASK;
    if (wireType === WIRE_TYPE_VARINT) {
      offset = readVarint(buffer, offset).offset;
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

    const fieldLength = readVarint(buffer, offset);
    offset = fieldLength.offset;

    if (fieldNumber === FIELD_STREAMER_CONTEXT) {
      const poToken = parseStreamerContext(buffer.subarray(offset, offset + fieldLength.value));
      if (poToken) {
        return poToken;
      }
    }

    offset += fieldLength.value;
  }

  return null;
}
