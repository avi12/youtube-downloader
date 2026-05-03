const SEGMENT_ID = 0x18538067;
const CLUSTER_ID = 0x1F43B675;
const TIMESTAMP_ID = 0xE7;
const SIMPLE_BLOCK_ID = 0xA3;
const OPUS_DTX_MAX_PAYLOAD_BYTES = 5;
const OPUS_FRAME_DURATION_MS = 20;

interface ClusterRecord {
  timestampOffset: number;
  timestampLength: number;
  timestampMs: number;
  sizeOffset: number;
  sizeLength: number;
  declaredSize: number;
  isUnknownSize: boolean;
}

interface BlockRecord {
  elementStart: number;
  elementEnd: number;
  relTimecodeOffset: number;
  payloadSize: number;
  clusterIdx: number;
}

// Strips Opus DTX (discontinuous-transmission) silence SimpleBlocks that YouTube's
// SABR encoder injects at audio-fragment boundaries (~every 7s within a captured
// segment). With -c:a copy these become exact digital-zero gaps in the output;
// removing them and compressing the surrounding timestamps closes the gap.
export function stripWebmDtxClusters(data: Uint8Array): Uint8Array {
  const buf = new Uint8Array(data);

  function readVint(offset: number, keepLeadingBit: boolean) {
    if (offset >= buf.byteLength) {
      return null;
    }

    const firstByte = buf[offset];
    if (!firstByte) {
      return null;
    }

    let length = 1;
    let mask = 0x80;
    while (mask > 0 && (firstByte & mask) === 0) {
      length++; mask >>= 1;
    }

    if (length > 8 || offset + length > buf.byteLength) {
      return null;
    }

    let value = keepLeadingBit ? firstByte : (firstByte & (mask - 1));
    for (let i = 1; i < length; i++) {
      value = value * 256 + buf[offset + i]!;
    }
    return {
      value,
      length
    };
  }

  function readUint(offset: number, length: number) {
    let value = 0;
    for (let i = 0; i < length; i++) {
      value = value * 256 + buf[offset + i]!;
    }
    return value;
  }

  function writeUint(offset: number, length: number, value: number) {
    let remaining = value;
    for (let i = length - 1; i >= 0; i--) {
      buf[offset + i] = remaining & 0xFF;
      remaining = Math.floor(remaining / 256);
    }
  }

  function writeVintSize(offset: number, length: number, value: number) {
    const markerBit = 0x80 >> (length - 1);
    let remaining = value;
    for (let i = length - 1; i > 0; i--) {
      buf[offset + i] = remaining & 0xFF;
      remaining = Math.floor(remaining / 256);
    }
    buf[offset] = markerBit | (remaining & (markerBit - 1));
  }

  function checkIsUnknownSize(sizeOffset: number, length: number) {
    const leadingMarkerBit = 0x80 >> (length - 1);
    const expectedFirstByte = leadingMarkerBit | (leadingMarkerBit - 1);
    if (buf[sizeOffset] !== expectedFirstByte) {
      return false;
    }

    for (let i = 1; i < length; i++) {
      if (buf[sizeOffset + i] !== 0xFF) {
        return false;
      }
    }
    return true;
  }

  function readChild(parentEnd: number, position: number) {
    const id = readVint(position, true);
    if (!id) {
      return null;
    }

    const sizeOffset = position + id.length;
    const size = readVint(sizeOffset, false);
    if (!size) {
      return null;
    }

    const dataStart = sizeOffset + size.length;
    const isUnkSize = checkIsUnknownSize(sizeOffset, size.length);
    const declaredEnd = isUnkSize ? parentEnd : dataStart + size.value;
    const dataEnd = Math.min(declaredEnd, parentEnd);
    if (dataStart > parentEnd) {
      return null;
    }

    return {
      id: id.value,
      elementStart: position,
      sizeOffset,
      sizeLength: size.length,
      declaredSize: size.value,
      isUnkSize,
      dataStart,
      dataEnd
    };
  }

  const clusters: ClusterRecord[] = [];
  const blocksByCluster: BlockRecord[][] = [];

  function scanCluster(clusterIdx: number, start: number, end: number) {
    const clusterBlocks: BlockRecord[] = [];
    blocksByCluster[clusterIdx] = clusterBlocks;
    let position = start;
    while (position < end) {
      const child = readChild(end, position);
      if (!child) {
        break;
      }

      if (child.id === TIMESTAMP_ID) {
        const tsLen = child.dataEnd - child.dataStart;
        const cluster = clusters[clusterIdx]!;
        cluster.timestampOffset = child.dataStart;
        cluster.timestampLength = tsLen;
        cluster.timestampMs = readUint(child.dataStart, tsLen);
      } else if (child.id === SIMPLE_BLOCK_ID) {
        const trackNum = readVint(child.dataStart, false);
        if (trackNum) {
          const relTimecodeOffset = child.dataStart + trackNum.length;
          const payloadSize = child.dataEnd - relTimecodeOffset - 3;
          clusterBlocks.push({
            elementStart: child.elementStart,
            elementEnd: child.dataEnd,
            relTimecodeOffset,
            payloadSize: Math.max(0, payloadSize),
            clusterIdx
          });
        }
      }

      position = child.dataEnd;
    }
  }

  function scanSegment(start: number, end: number) {
    let position = start;
    while (position < end) {
      const child = readChild(end, position);
      if (!child) {
        break;
      }

      if (child.id === CLUSTER_ID) {
        const clusterIdx = clusters.length;
        clusters.push({
          timestampOffset: 0,
          timestampLength: 0,
          timestampMs: 0,
          sizeOffset: child.sizeOffset,
          sizeLength: child.sizeLength,
          declaredSize: child.declaredSize,
          isUnknownSize: child.isUnkSize
        });
        scanCluster(clusterIdx, child.dataStart, child.dataEnd);
      }

      position = child.dataEnd;
    }
  }

  let position = 0;
  while (position < buf.byteLength) {
    const child = readChild(buf.byteLength, position);
    if (!child) {
      break;
    }

    if (child.id === SEGMENT_ID) {
      scanSegment(child.dataStart, child.dataEnd);
    }

    position = child.dataEnd;
  }

  let accumulatedMs = 0;
  const deletedRanges: Array<[number, number]> = [];

  for (let clusterIdx = 0; clusterIdx < clusters.length; clusterIdx++) {
    const cluster = clusters[clusterIdx]!;
    const clusterBlocks = blocksByCluster[clusterIdx] ?? [];
    // Clusters whose Timestamp element was not found cannot have their
    // timestamps adjusted — but DTX blocks inside them must still be stripped
    // to prevent lone DTX frames surviving at the tail of the audio stream.
    if (cluster.timestampLength === 0) {
      for (const block of clusterBlocks) {
        if (block.payloadSize <= OPUS_DTX_MAX_PAYLOAD_BYTES) {
          deletedRanges.push([block.elementStart, block.elementEnd]);
          accumulatedMs += OPUS_FRAME_DURATION_MS;
        }
      }
      continue;
    }

    const clusterStartMs = accumulatedMs;
    let dtxBytesInCluster = 0;
    let intraClusterMs = 0;

    for (const block of clusterBlocks) {
      if (block.payloadSize <= OPUS_DTX_MAX_PAYLOAD_BYTES) {
        deletedRanges.push([block.elementStart, block.elementEnd]);
        dtxBytesInCluster += block.elementEnd - block.elementStart;
        accumulatedMs += OPUS_FRAME_DURATION_MS;
        intraClusterMs += OPUS_FRAME_DURATION_MS;
      } else if (intraClusterMs > 0) {
        const off = block.relTimecodeOffset;
        const raw = ((buf[off]! << 8) | buf[off + 1]!) & 0xFFFF;
        const signed = raw >= 0x8000 ? raw - 0x10000 : raw;
        const newRaw = (signed - intraClusterMs) & 0xFFFF;
        buf[off] = (newRaw >> 8) & 0xFF;
        buf[off + 1] = newRaw & 0xFF;
      }
    }

    if (clusterStartMs > 0) {
      writeUint(cluster.timestampOffset, cluster.timestampLength, Math.max(0, cluster.timestampMs - clusterStartMs));
    }

    if (!cluster.isUnknownSize && dtxBytesInCluster > 0) {
      writeVintSize(cluster.sizeOffset, cluster.sizeLength, cluster.declaredSize - dtxBytesInCluster);
    }
  }

  if (accumulatedMs === 0) {
    return data;
  }

  const totalDeleted = deletedRanges.reduce((sum, [start, end]) => sum + end - start, 0);
  const output = new Uint8Array(buf.byteLength - totalDeleted);
  let outPos = 0;
  let inPos = 0;

  const sortedDeletions = [...deletedRanges].sort((rangeA, rangeB) => rangeA[0] - rangeB[0]);
  for (const [deleteStart, deleteEnd] of sortedDeletions) {
    if (inPos < deleteStart) {
      output.set(buf.subarray(inPos, deleteStart), outPos);
      outPos += deleteStart - inPos;
    }

    inPos = deleteEnd;
  }

  if (inPos < buf.byteLength) {
    output.set(buf.subarray(inPos), outPos);
  }

  return output;
}
