import type { Prettify } from "@/types";

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

type ReadVarintParams = Prettify<{
  buffer: Uint8Array;
  offset: number;
}>;
export function readVarint({ buffer, offset }: ReadVarintParams) {
  let value = 0;
  let shift = 0;
  while (offset < buffer.byteLength) {
    const byte = buffer[offset];
    offset++;
    value |= (byte & VARINT_DATA_BITS_MASK) << shift;

    const isLastByte = (byte & VARINT_CONTINUATION_BIT) === 0;
    if (isLastByte) {
      break;
    }

    shift += VARINT_BITS_PER_BYTE;
  }
  return {
    value: value >>> 0,
    offset
  };
}
