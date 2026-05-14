export const VARINT_DATA_BITS_MASK = 0x7f;
export const VARINT_CONTINUATION_BIT = 0x80;
export const VARINT_BITS_PER_BYTE = 7;
export const PROTO_FIELD_NUMBER_SHIFT = 3;
export const PROTO_WIRE_TYPE_MASK = 0x7;
export const WIRE_TYPE_VARINT = 0;
export const WIRE_TYPE_64_BIT = 1;
export const WIRE_TYPE_LENGTH_DELIMITED = 2;
export const WIRE_TYPE_32_BIT = 5;
export const WIRE_64_BIT_BYTE_SIZE = 8;
export const WIRE_32_BIT_BYTE_SIZE = 4;

export function readVarint(buffer: Uint8Array, off: number) {
  let value = 0;
  let shift = 0;
  while (off < buffer.byteLength) {
    const byte = buffer[off];
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
