import {
  CONTAINER_SPECS,
  extractBaseCodec,
  FFMPEG_CODEC_COPY,
  getAudioFallbackCodec,
  resolveAudioCodec
} from "@/lib/utils/containers";
import { type AdaptiveFormatItem, DownloadType, type Prettify } from "@/types";

const MILLISECONDS_PER_SECOND = 1000;
const BITS_PER_BYTE = 8;
const DEFAULT_FRAMES_PER_SECOND = 30;
const DEFAULT_AUDIO_SAMPLE_RATE = 48_000;
const AAC_SAMPLES_PER_PACKET = 1024;
const OPUS_PACKETS_PER_SECOND = 50;
const AC3_SAMPLES_PER_PACKET = 1536;

const SIDX_HEADER_BYTES = 32;
const SIDX_REFERENCE_BYTES = 12;
const MP4_VIDEO_FRAGMENT_BYTES = 100;
const MP4_AUDIO_FRAGMENT_BYTES = 104;
const MP4_DEFAULT_SAMPLE_ENTRY_BYTES = 8;
const MP4_SAMPLE_ENTRY_BYTES: Record<string, number> = {
  avc1: 12,
  av01: 10,
  mp4a: 4
};
const WEBM_VIDEO_CLUSTER_BYTES_PER_SECOND = 3.5;
const WEBM_AUDIO_CLUSTER_BYTES_PER_SECOND = 1.4;

const MATROSKA_BLOCK_FIXED_BYTES = 5;
const MATROSKA_BLOCK_SIZE_OFFSET = 4;
const MATROSKA_SUBTITLE_BLOCK_EXTRA_BYTES = 7;
const MATROSKA_ONE_BYTE_SIZE_LIMIT = 127;
const SMALL_VIDEO_FRAME_SPREAD = 2;
const MATROSKA_BASE_BYTES = 1709;
const MATROSKA_BYTES_PER_SECOND = 11;
const MATROSKA_ASS_TRACK_BYTES = 420;
const MATROSKA_AUDIO_ONLY_BASE_BYTES = 1300;
const WEBM_BASE_BYTES = 1090;
const WEBM_BYTES_PER_SECOND = 9.2;
const WEBM_WEBVTT_TRACK_BYTES = 40;
const MP4_OUTPUT_BASE_BYTES = -2420;
const MP4_OUTPUT_BYTES_PER_SAMPLE = 11.66;
const MP4_OUTPUT_AVC_BYTES_PER_FRAME = 5.46;
const MP4_OUTPUT_AVC_BASE_BYTES = 236;
const MP4_AUDIO_ONLY_BASE_BYTES = 1000;
const MP4_AUDIO_ONLY_BYTES_PER_SAMPLE = 4.1;

const MP3_SAMPLES_PER_FRAME = 1152;
const MP3_ENCODER_DELAY_SAMPLES = 1105;
const MP3_BITRATE = 128_000;
const MP3_FRAME_BYTES_FACTOR = 144;
const ID3_HEADER_BYTES = 10;
const ID3_FRAME_HEADER_BYTES = 11;
const ID3_PICTURE_HEADER_BYTES = 25;
const ENCODER_TAG = "Lavf59.27.100";
const TAG_OVERHEAD_BYTES = 24;

const ENCODER_BITS_PER_SECOND: Record<string, number> = {
  aac: 129_400,
  libmp3lame: MP3_BITRATE,
  libopus: 96_000,
  libvorbis: 112_000
};

const MKV_EXTENSIONS = new Set(["mkv", "mka"]);
const WEBM_EXTENSIONS = new Set(["webm", "weba"]);
const MP4_EXTENSIONS = new Set(["mp4", "m4a", "mov", "m4v"]);
const MP3_EXTENSION = "mp3";

export type SizeInputs = Prettify<{
  captionVtts: (string | null)[];
  coverBytes: number;
  tags: string[];
}>;

type Cue = Prettify<{
  startSeconds: number;
  endSeconds: number;
  text: string;
}>;

function parseTimestamp(value: string) {
  return value.split(":").reduce((seconds, part) => seconds * 60 + Number(part), 0);
}

function parseVttCues(vtt: string) {
  const cues: Cue[] = [];
  for (const block of vtt.replaceAll("\r", "").split("\n\n").slice(1)) {
    const [timing, ...textLines] = block.replace(/^\n+|\n+$/g, "").split("\n");
    if (!timing?.includes("-->")) {
      continue;
    }

    const [start, end] = timing.split("-->").map(part => part.trim().split(" ")[0]);
    cues.push({
      startSeconds: parseTimestamp(start),
      endSeconds: parseTimestamp(end),
      text: textLines.join("\n")
    });
  }

  return cues;
}

const ENCODER = new TextEncoder();
function byteLength(text: string) {
  return ENCODER.encode(text).byteLength;
}

function measureCaptionTrack(vtt: string, extension: string) {
  const cues = parseVttCues(vtt);
  if (MKV_EXTENSIONS.has(extension)) {
    return {
      payload: cues.reduce((sum, cue, i) => sum + byteLength(`${i},0,Default,,0,0,0,,${cue.text.replaceAll("\n", "\\N")}`), 0),
      packets: cues.length
    };
  }

  if (MP4_EXTENSIONS.has(extension)) {
    let gaps = 0;
    let previousEnd = 0;
    for (const cue of cues) {
      if (cue.startSeconds > previousEnd) {
        gaps++;
      }

      previousEnd = cue.endSeconds;
    }

    return {
      payload: cues.reduce((sum, cue) => sum + 2 + byteLength(cue.text), 0) + gaps * 2,
      packets: cues.length + gaps
    };
  }

  return {
    payload: cues.reduce((sum, cue) => sum + byteLength(cue.text), 0),
    packets: cues.length
  };
}

function durationSeconds(format: AdaptiveFormatItem) {
  return Number(format.approxDurationMs ?? 0) / MILLISECONDS_PER_SECOND;
}

function sampleRate(format: AdaptiveFormatItem) {
  return Number(format.audioSampleRate ?? DEFAULT_AUDIO_SAMPLE_RATE);
}

function countPackets(format: AdaptiveFormatItem) {
  const seconds = durationSeconds(format);
  const codec = extractBaseCodec(format.mimeType);
  if (format.mimeType.startsWith("video")) {
    return Math.round(seconds * (format.fps ?? DEFAULT_FRAMES_PER_SECOND));
  }

  if (codec === "opus") {
    return Math.round(seconds * OPUS_PACKETS_PER_SECOND);
  }

  const samplesPerPacket = codec === "ac-3" || codec === "ec-3" ? AC3_SAMPLES_PER_PACKET : AAC_SAMPLES_PER_PACKET;
  return Math.round(seconds * sampleRate(format) / samplesPerPacket);
}

function rangeLength(range: {
  start: string;
  end: string;
} | undefined) {
  return range ? Number(range.end) - Number(range.start) + 1 : 0;
}

function vintLength(value: number) {
  let length = 1;
  while (value >= 2 ** (7 * length) - 1) {
    length++;
  }

  return length;
}

function estimateMatroskaBlockBytes(packets: number, payload: number, isVideo: boolean) {
  const averagePacket = payload / Math.max(packets, 1);
  const blockBytes = packets * (MATROSKA_BLOCK_FIXED_BYTES + vintLength(averagePacket + MATROSKA_BLOCK_SIZE_OFFSET));
  const isTwoByteAverage = vintLength(averagePacket + MATROSKA_BLOCK_SIZE_OFFSET) === 2;
  if (!isVideo || !isTwoByteAverage) {
    return blockBytes;
  }

  const smallFrameShare = 1 - Math.exp(-SMALL_VIDEO_FRAME_SPREAD * MATROSKA_ONE_BYTE_SIZE_LIMIT / averagePacket);
  return blockBytes - packets * smallFrameShare;
}

function isWebmSource(format: AdaptiveFormatItem) {
  return format.mimeType.includes("webm");
}

function webmClusterBytes(format: AdaptiveFormatItem) {
  const perSecond = format.mimeType.startsWith("video")
    ? WEBM_VIDEO_CLUSTER_BYTES_PER_SECOND
    : WEBM_AUDIO_CLUSTER_BYTES_PER_SECOND;
  return durationSeconds(format) * perSecond;
}

function contentLength(format: AdaptiveFormatItem) {
  const bytes = Number(format.contentLength ?? 0);
  if (bytes > 0) {
    return bytes;
  }

  return Math.round(format.bitrate * durationSeconds(format) / BITS_PER_BYTE);
}

function measureSourceStream(format: AdaptiveFormatItem) {
  const packets = countPackets(format);
  const headerBytes = rangeLength(format.initRange) + rangeLength(format.indexRange);
  const totalBytes = contentLength(format);
  if (isWebmSource(format)) {
    const payloadAndBlocks = totalBytes - headerBytes - webmClusterBytes(format);
    const blockBytes = estimateMatroskaBlockBytes(packets, payloadAndBlocks, false);
    return {
      packets,
      payload: payloadAndBlocks - blockBytes,
      matroskaBlockBytes: blockBytes
    };
  }

  const fragments = Math.max(0, (rangeLength(format.indexRange) - SIDX_HEADER_BYTES) / SIDX_REFERENCE_BYTES);
  const isVideo = format.mimeType.startsWith("video");
  const fragmentBytes = fragments * (isVideo ? MP4_VIDEO_FRAGMENT_BYTES : MP4_AUDIO_FRAGMENT_BYTES);
  const sampleEntryBytes = MP4_SAMPLE_ENTRY_BYTES[extractBaseCodec(format.mimeType)] ?? MP4_DEFAULT_SAMPLE_ENTRY_BYTES;
  const payload = totalBytes - headerBytes - fragmentBytes - packets * sampleEntryBytes;
  return {
    packets,
    payload,
    matroskaBlockBytes: estimateMatroskaBlockBytes(packets, payload, isVideo)
  };
}

function measureEncodedAudio(format: AdaptiveFormatItem, encoder: string) {
  const seconds = durationSeconds(format);
  if (encoder === "libmp3lame") {
    const rate = sampleRate(format);
    const frames = Math.ceil((seconds * rate + MP3_ENCODER_DELAY_SAMPLES) / MP3_SAMPLES_PER_FRAME);
    return {
      payload: frames * Math.floor(MP3_FRAME_BYTES_FACTOR * MP3_BITRATE / rate),
      packets: frames,
      isApproximate: false
    };
  }

  const bitsPerSecond = ENCODER_BITS_PER_SECOND[encoder] ?? format.bitrate;
  return {
    payload: Math.round(seconds * bitsPerSecond / BITS_PER_BYTE),
    packets: Math.round(seconds * sampleRate(format) / AAC_SAMPLES_PER_PACKET),
    isApproximate: true
  };
}

function measureTags(tags: string[]) {
  return [...tags, ENCODER_TAG].reduce((sum, tag) => sum + byteLength(tag) + TAG_OVERHEAD_BYTES, 0);
}

type PredictMuxedParams = Prettify<{
  videoFormat: AdaptiveFormatItem;
  audioFormats: AdaptiveFormatItem[];
  captionVtts: string[];
  extension: string;
}>;
function predictMuxed({ videoFormat, audioFormats, captionVtts, extension }: PredictMuxedParams) {
  const video = measureSourceStream(videoFormat);
  const seconds = durationSeconds(videoFormat);
  const captions = captionVtts.map(vtt => measureCaptionTrack(vtt, extension));
  const captionPayload = captions.reduce((sum, caption) => sum + caption.payload, 0);
  const captionPackets = captions.reduce((sum, caption) => sum + caption.packets, 0);
  let isApproximate = false;
  const audios = audioFormats.map(format => {
    const encoder = resolveAudioCodec({
      audioMimeType: format.mimeType,
      targetExtension: extension
    });
    if (encoder === FFMPEG_CODEC_COPY) {
      return measureSourceStream(format);
    }

    isApproximate = true;
    const encoded = measureEncodedAudio(format, encoder);
    return {
      ...encoded,
      matroskaBlockBytes: estimateMatroskaBlockBytes(encoded.packets, encoded.payload, false)
    };
  });
  const streamPayload = video.payload + audios.reduce((sum, audio) => sum + audio.payload, 0) + captionPayload;
  const audioPackets = audios.reduce((sum, audio) => sum + audio.packets, 0);
  if (MP4_EXTENSIONS.has(extension)) {
    const isAvc = extractBaseCodec(videoFormat.mimeType) === "avc1";
    const avcBytes = isAvc ? MP4_OUTPUT_AVC_BASE_BYTES + MP4_OUTPUT_AVC_BYTES_PER_FRAME * video.packets : 0;
    const sampleCount = video.packets + audioPackets + captionPackets;
    return {
      bytes: streamPayload + MP4_OUTPUT_BASE_BYTES + MP4_OUTPUT_BYTES_PER_SAMPLE * sampleCount + avcBytes,
      isApproximate
    };
  }

  const blockBytes = video.matroskaBlockBytes
    + audios.reduce((sum, audio) => sum + audio.matroskaBlockBytes, 0)
    + captionPackets * (MATROSKA_BLOCK_FIXED_BYTES + MATROSKA_SUBTITLE_BLOCK_EXTRA_BYTES);
  const isWebm = WEBM_EXTENSIONS.has(extension);
  const structureBytes = isWebm
    ? WEBM_BASE_BYTES + WEBM_BYTES_PER_SECOND * seconds + WEBM_WEBVTT_TRACK_BYTES * captions.length
    : MATROSKA_BASE_BYTES + MATROSKA_BYTES_PER_SECOND * seconds + MATROSKA_ASS_TRACK_BYTES * captions.length;
  return {
    bytes: streamPayload + blockBytes + structureBytes,
    isApproximate
  };
}

type PredictAudioOnlyParams = Prettify<{
  audioFormat: AdaptiveFormatItem;
  extension: string;
  inputs: SizeInputs | null;
}>;
function predictAudioOnly({ audioFormat, extension, inputs }: PredictAudioOnlyParams) {
  const sourceExtension = isWebmSource(audioFormat) ? "weba" : "m4a";
  const isWebmOutput = WEBM_EXTENSIONS.has(extension);
  const isEmbedPath = !!inputs && inputs.coverBytes > 0 && !isWebmOutput;
  const isRawCopy = !isEmbedPath && (sourceExtension === extension || (sourceExtension === "weba" && extension === "webm"));
  if (isRawCopy) {
    return {
      bytes: contentLength(audioFormat),
      isApproximate: false
    };
  }

  const encoder = resolveAudioCodec({
    audioMimeType: audioFormat.mimeType,
    targetExtension: extension
  });
  const audio = encoder === FFMPEG_CODEC_COPY
    ? {
      ...measureSourceStream(audioFormat),
      isApproximate: false
    }
    : measureEncodedAudio(audioFormat, isEmbedPath ? encoder : (getAudioFallbackCodec(extension) ?? encoder));
  const extraBytes = isEmbedPath ? inputs.coverBytes + measureTags(inputs.tags) : 0;
  const isApproximate = audio.isApproximate || !inputs;
  if (extension === MP3_EXTENSION) {
    const pictureBytes = isEmbedPath ? ID3_PICTURE_HEADER_BYTES : 0;
    return {
      bytes: Math.round(audio.payload + extraBytes + ID3_HEADER_BYTES + ID3_FRAME_HEADER_BYTES + pictureBytes),
      isApproximate
    };
  }

  if (MP4_EXTENSIONS.has(extension)) {
    const tableBytes = MP4_AUDIO_ONLY_BASE_BYTES + MP4_AUDIO_ONLY_BYTES_PER_SAMPLE * audio.packets;
    return {
      bytes: Math.round(audio.payload + extraBytes + tableBytes),
      isApproximate
    };
  }

  const blockBytes = estimateMatroskaBlockBytes(audio.packets, audio.payload, false);
  return {
    bytes: Math.round(audio.payload + extraBytes + blockBytes + MATROSKA_AUDIO_ONLY_BASE_BYTES),
    isApproximate: isApproximate || !MKV_EXTENSIONS.has(extension)
  };
}

type PredictOutputSizeParams = Prettify<{
  type: DownloadType;
  extension: string;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem | null;
  extraAudioFormats: AdaptiveFormatItem[];
  inputs: SizeInputs | null;
}>;
export function predictOutputSize({
  type, extension, videoFormat, audioFormat, extraAudioFormats, inputs
}: PredictOutputSizeParams) {
  const isVideoOnly = type === DownloadType.Video;
  if (isVideoOnly) {
    return videoFormat ? {
      bytes: contentLength(videoFormat),
      isApproximate: false
    } : null;
  }

  if (!audioFormat) {
    return null;
  }

  const isAudioOnly = type === DownloadType.Audio;
  if (isAudioOnly) {
    return predictAudioOnly({
      audioFormat,
      extension,
      inputs
    });
  }

  if (!videoFormat) {
    return null;
  }

  const muxed = predictMuxed({
    videoFormat,
    audioFormats: [audioFormat, ...extraAudioFormats],
    captionVtts: (inputs?.captionVtts ?? []).filter(vtt => vtt !== null),
    extension: extension in CONTAINER_SPECS ? extension : "mkv"
  });
  return {
    bytes: Math.round(muxed.bytes),
    isApproximate: muxed.isApproximate || !inputs
  };
}
