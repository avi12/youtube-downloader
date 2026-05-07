// Detects and closes timing gaps between fMP4 audio sub-fragments.
// YouTube's SABR m4a stream embeds ~400ms gaps at sub-fragment boundaries
// (every ~37-38s). FFmpeg fills these gaps with PCM silence when re-encoding,
// producing audible dropouts in the downloaded audio.
//
// This function patches the baseMediaDecodeTime in every moof/traf/tfdt box
// after a detected gap, compressing the timeline so sub-fragments are
// contiguous. The mdat sample bytes are untouched; only the PTS header values
// change.
//
// Gap threshold: 10ms expressed in timescale units. This is timescale-aware so
// both timescale=48000 (480 units) and timescale=1000 (10 units) correctly catch
// the ~400ms YouTube gap while ignoring sub-frame rounding artefacts.
const GAP_THRESHOLD_MS = 10;
const DEFAULT_AAC_FRAME_SAMPLES = 1024;

interface FragmentRecord {
  tfdtDataOffset: number;
  tfdtVersion: number;
  baseMediaDecodeTime: number;
  fragmentDurationUnits: number;
}

export function closeFmp4AudioGaps(data: Uint8Array, logEvent?: (msg: string) => void): Uint8Array {
  if (data.byteLength < 8) {
    return data;
  }

  const buf = new Uint8Array(data);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  function readU8(offset: number) {
    return buf[offset]!;
  }
  function readU32(offset: number) {
    return view.getUint32(offset);
  }
  function writeU32(offset: number, value: number) {
    view.setUint32(offset, value);
  }

  function readBoxSize(offset: number) {
    return readU32(offset);
  }
  function readBoxName(offset: number) {
    return String.fromCharCode(buf[offset]!, buf[offset + 1]!, buf[offset + 2]!, buf[offset + 3]!);
  }

  let timescale: number | undefined;
  const fragments: FragmentRecord[] = [];

  function parseTfhd(dataStart: number): {
    defaultSampleDuration: number | undefined;
  } {
    const flags = (readU8(dataStart + 1) << 16) | (readU8(dataStart + 2) << 8) | readU8(dataStart + 3);
    let pos = dataStart + 4 + 4; // version(1)+flags(3)+track_id(4)
    if (flags & 0x000001) {
      pos += 8;
    } // base_data_offset

    if (flags & 0x000002) {
      pos += 4;
    } // sample_description_index

    if (flags & 0x000008) {
      return { defaultSampleDuration: readU32(pos) };
    }

    return { defaultSampleDuration: undefined };
  }

  function parseTrun(dataStart: number, defaultSampleDuration: number | undefined): number {
    const flags = (readU8(dataStart + 1) << 16) | (readU8(dataStart + 2) << 8) | readU8(dataStart + 3);
    const sampleCount = readU32(dataStart + 4);
    let pos = dataStart + 8;
    if (flags & 0x001) {
      pos += 4;
    } // data_offset

    if (flags & 0x004) {
      pos += 4;
    } // first_sample_flags

    const hasDuration = !!(flags & 0x100);
    const hasSize = !!(flags & 0x200);
    const hasFlags = !!(flags & 0x400);
    const hasCTSO = !!(flags & 0x800);
    const bytesPerSample = (hasDuration ? 4 : 0) + (hasSize ? 4 : 0) + (hasFlags ? 4 : 0) + (hasCTSO ? 4 : 0);
    if (!hasDuration) {
      const dur = defaultSampleDuration ?? DEFAULT_AAC_FRAME_SAMPLES;
      return sampleCount * dur;
    }

    let total = 0;
    for (let i = 0; i < sampleCount && pos + bytesPerSample <= buf.byteLength; i++) {
      total += readU32(pos);
      pos += bytesPerSample;
    }
    return total;
  }

  function parseTraf(start: number, end: number) {
    let tfdtDataOffset: number | undefined;
    let tfdtVersion = 0;
    let baseMediaDecodeTime = 0;
    let defaultSampleDuration: number | undefined;
    let totalDuration = 0;

    let pos = start;
    while (pos + 8 <= end) {
      const boxSize = readBoxSize(pos);
      if (boxSize < 8 || pos + boxSize > end) {
        break;
      }

      const boxName = readBoxName(pos + 4);
      const dataStart = pos + 8;
      if (boxName === "tfhd") {
        ({ defaultSampleDuration } = parseTfhd(dataStart));
      } else if (boxName === "tfdt") {
        tfdtVersion = readU8(dataStart);
        tfdtDataOffset = dataStart + 4;

        if (tfdtVersion === 1) {
          const high = readU32(dataStart + 4);
          const low = readU32(dataStart + 8);
          baseMediaDecodeTime = high * 0x1_0000_0000 + low;
        } else {
          baseMediaDecodeTime = readU32(dataStart + 4);
        }
      } else if (boxName === "trun") {
        totalDuration += parseTrun(dataStart, defaultSampleDuration);
      }

      pos += boxSize;
    }

    if (tfdtDataOffset !== undefined) {
      fragments.push({
        tfdtDataOffset,
        tfdtVersion,
        baseMediaDecodeTime,
        fragmentDurationUnits: totalDuration
      });
    }
  }

  function scanBoxes(start: number, end: number) {
    let pos = start;
    while (pos + 8 <= end) {
      const boxSize = readBoxSize(pos);
      if (boxSize < 8 || pos + boxSize > end) {
        break;
      }

      const boxName = readBoxName(pos + 4);
      const dataStart = pos + 8;
      if (boxName === "moov" || boxName === "trak" || boxName === "mdia" || boxName === "mvex") {
        scanBoxes(dataStart, pos + boxSize);
      } else if (boxName === "mdhd" && timescale === undefined) {
        const version = readU8(dataStart);
        timescale = version === 1 ? readU32(dataStart + 20) : readU32(dataStart + 12);
      } else if (boxName === "moof") {
        let innerPos = dataStart;
        const moofEnd = pos + boxSize;
        while (innerPos + 8 <= moofEnd) {
          const innerSize = readBoxSize(innerPos);
          if (innerSize < 8 || innerPos + innerSize > moofEnd) {
            break;
          }

          if (readBoxName(innerPos + 4) === "traf") {
            parseTraf(innerPos + 8, innerPos + innerSize);
          }

          innerPos += innerSize;
        }
      }

      pos += boxSize;
    }
  }

  scanBoxes(0, buf.byteLength);

  const resolvedTimescale = timescale ?? 48000;
  // Gap threshold in media time units, derived from GAP_THRESHOLD_MS so it scales
  // correctly whether timescale=48000 (units=480) or timescale=1000 (units=10).
  const gapThresholdUnits = Math.max(1, Math.floor(resolvedTimescale * GAP_THRESHOLD_MS / 1000));

  logEvent?.(`[ytdl:fmp4gaps] timescale=${resolvedTimescale} fragments=${fragments.length} threshold=${gapThresholdUnits}units`);

  if (fragments.length < 2) {
    return data;
  }

  let accumulatedGapUnits = 0;
  const detectedGaps: number[] = [];

  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i]!;
    if (accumulatedGapUnits > 0) {
      const adjusted = frag.baseMediaDecodeTime - accumulatedGapUnits;
      if (frag.tfdtVersion === 1) {
        writeU32(frag.tfdtDataOffset, Math.floor(adjusted / 0x1_0000_0000));
        writeU32(frag.tfdtDataOffset + 4, adjusted >>> 0);
      } else {
        writeU32(frag.tfdtDataOffset, adjusted >>> 0);
      }
    }

    if (i + 1 < fragments.length) {
      const expectedNextStart = (frag.baseMediaDecodeTime - accumulatedGapUnits) + frag.fragmentDurationUnits;
      const actualNextRaw = fragments[i + 1]!.baseMediaDecodeTime;
      const gap = actualNextRaw - accumulatedGapUnits - expectedNextStart;
      if (gap > gapThresholdUnits) {
        detectedGaps.push(gap);
        accumulatedGapUnits += gap;
      }
    }
  }

  logEvent?.(`[ytdl:fmp4gaps] gaps=${detectedGaps.map(gapUnits => `${gapUnits}units(${(gapUnits / resolvedTimescale * 1000).toFixed(0)}ms)`).join(",") || "none"} totalClosed=${(accumulatedGapUnits / resolvedTimescale * 1000).toFixed(0)}ms`);

  if (accumulatedGapUnits === 0) {
    return data;
  }

  return buf;
}
