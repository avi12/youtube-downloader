// Reads the actual start time of an fMP4 video stream by parsing the
// baseMediaDecodeTime from the first tfdt box and the timescale from mdhd.
// HTMLMediaElement.buffered returns the intersection of all SourceBuffers,
// so video.buffered.start(0) equals the audio start (startSec), not the
// video keyframe-snapped start. Parsing the raw fMP4 bytes gives the real
// value without the intersection bias.
// Returns undefined for non-fMP4 containers (e.g. WebM) or on parse failure.
export function parseFmp4VideoStartSec(data: Uint8Array): number | undefined {
  if (data.byteLength < 8) {
    return undefined;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  function readBoxName(offset: number) {
    return String.fromCharCode(data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!);
  }

  function readBoxSize(offset: number) {
    return view.getUint32(offset);
  }

  let timescale: number | undefined;
  let baseMediaDecodeTime: number | undefined;

  // Container boxes whose children we recurse into.
  // mdhd lives at: moov → trak → mdia
  // tfdt lives at: moof → traf
  const CONTAINER_BOXES = new Set(["moov", "trak", "mdia", "moof", "traf"]);

  function scanBoxes(start: number, end: number) {
    let offset = start;
    while (offset + 8 <= end) {
      const boxSize = readBoxSize(offset);
      if (boxSize < 8 || offset + boxSize > end) {
        break;
      }

      const boxName = readBoxName(offset + 4);
      const dataStart = offset + 8;
      if (boxName === "mdhd" && timescale === undefined) {
        const version = data[dataStart];
        // version 0: created(4) + modified(4) = 8 bytes before timescale
        // version 1: created(8) + modified(8) = 16 bytes before timescale
        // Both preceded by version(1) + flags(3) = 4 bytes
        timescale = version === 1
          ? view.getUint32(dataStart + 20)
          : view.getUint32(dataStart + 12);
      } else if (boxName === "tfdt" && baseMediaDecodeTime === undefined) {
        const version = data[dataStart];
        // version 0: version(1) + flags(3) + baseMediaDecodeTime(4)
        // version 1: version(1) + flags(3) + baseMediaDecodeTime(8)
        if (version === 1) {
          const high = view.getUint32(dataStart + 4);
          const low = view.getUint32(dataStart + 8);
          // Avoid BigInt for ffmpeg.wasm compat - videos < ~34 years fit in float64.
          baseMediaDecodeTime = high * 0x1_0000_0000 + low;
        } else {
          baseMediaDecodeTime = view.getUint32(dataStart + 4);
        }
      } else if (CONTAINER_BOXES.has(boxName)) {
        scanBoxes(dataStart, offset + boxSize);
      }

      if (timescale !== undefined && baseMediaDecodeTime !== undefined) {
        return;
      }

      offset += boxSize;
    }
  }

  scanBoxes(0, data.byteLength);

  if (timescale === undefined || timescale === 0 || baseMediaDecodeTime === undefined) {
    return undefined;
  }

  return baseMediaDecodeTime / timescale;
}
