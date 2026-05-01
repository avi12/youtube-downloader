// Reads the actual start time of a WebM/Matroska audio fragment by walking
// EBML to the first Cluster's Timestamp element. The buffered SourceBuffer
// chunks for SABR audio typically include 5-10s of fragment data preceding
// the video keyframe, which causes audio-before-video duplication when
// FFmpeg's -avoid_negative_ts make_zero shifts the earliest PTS to zero.
// Returns undefined for non-WebM containers or on parse failure.
const SEGMENT_ID = 0x18538067;
const INFO_ID = 0x1549A966;
const CLUSTER_ID = 0x1F43B675;
const TIMECODE_ID = 0xE7;
const TIMECODE_SCALE_ID = 0x2AD7B1;
const NANOSECONDS_PER_SECOND = 1_000_000_000;
const DEFAULT_TIMECODE_SCALE_NS = 1_000_000;

export function parseWebmAudioStartSec(data: Uint8Array) {
  function readVint(offset: number, keepLeadingBit: boolean) {
    if (offset >= data.byteLength) {
      return null;
    }

    const firstByte = data[offset];
    if (firstByte === undefined || firstByte === 0) {
      return null;
    }

    let length = 1;
    let mask = 0x80;
    while (mask > 0 && (firstByte & mask) === 0) {
      length++;
      mask >>= 1;
    }

    if (length > 8 || offset + length > data.byteLength) {
      return null;
    }

    let value = keepLeadingBit ? firstByte : (firstByte & (mask - 1));
    for (let i = 1; i < length; i++) {
      value = value * 256 + data[offset + i]!;
    }

    return {
      value,
      length
    };
  }

  function readUint(offset: number, length: number) {
    let value = 0;
    for (let i = 0; i < length; i++) {
      value = value * 256 + data[offset + i]!;
    }

    return value;
  }

  let timecodeScale = DEFAULT_TIMECODE_SCALE_NS;
  let firstClusterTimecode: number | undefined;

  function isUnknownSize(sizeOffset: number, length: number) {
    // EBML "unknown size" marker: all-1s in the value bits of the size vint.
    // Used by fragmented WebM where the Segment element grows as Clusters
    // are appended. Length-8 unknown-size value (2^56 - 1) exceeds the safe
    // integer range, so check the byte pattern directly. The leading byte
    // has the length-marker bit set with all subsequent value bits = 1, and
    // every byte after it is 0xFF.
    const leadingMarkerBit = 0x80 >> (length - 1);
    const expectedFirstByte = leadingMarkerBit | (leadingMarkerBit - 1);
    if (data[sizeOffset] !== expectedFirstByte) {
      return false;
    }

    for (let i = 1; i < length; i++) {
      if (data[sizeOffset + i] !== 0xFF) {
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
    // SABR streams pre-declare the full expected Segment size in the header
    // (e.g. 8MB for a 1MB capture), so an element whose declared size
    // overruns the buffer is normal for partial fragments. Clamp to parentEnd
    // and continue scanning the bytes we actually have rather than aborting.
    const declaredEnd = isUnknownSize(sizeOffset, size.length)
      ? parentEnd
      : dataStart + size.value;
    const dataEnd = Math.min(declaredEnd, parentEnd);
    if (dataStart > parentEnd) {
      return null;
    }

    return {
      id: id.value,
      dataStart,
      dataEnd
    };
  }

  function scanInfo(start: number, end: number) {
    let position = start;
    while (position < end) {
      const child = readChild(end, position);
      if (!child) {
        return;
      }

      if (child.id === TIMECODE_SCALE_ID) {
        timecodeScale = readUint(child.dataStart, child.dataEnd - child.dataStart);
      }

      position = child.dataEnd;
    }
  }

  function scanCluster(start: number, end: number) {
    let position = start;
    while (position < end) {
      const child = readChild(end, position);
      if (!child) {
        return;
      }

      if (child.id === TIMECODE_ID) {
        firstClusterTimecode = readUint(child.dataStart, child.dataEnd - child.dataStart);
        return;
      }

      position = child.dataEnd;
    }
  }

  function scanContainer(start: number, end: number) {
    let position = start;
    while (position < end && firstClusterTimecode === undefined) {
      const child = readChild(end, position);
      if (!child) {
        return;
      }

      if (child.id === SEGMENT_ID) {
        scanContainer(child.dataStart, child.dataEnd);
      } else if (child.id === INFO_ID) {
        scanInfo(child.dataStart, child.dataEnd);
      } else if (child.id === CLUSTER_ID) {
        scanCluster(child.dataStart, child.dataEnd);
      }

      position = child.dataEnd;
    }
  }

  scanContainer(0, data.byteLength);

  if (firstClusterTimecode === undefined) {
    return undefined;
  }

  return (firstClusterTimecode * timecodeScale) / NANOSECONDS_PER_SECOND;
}
