import { readStreamToBuffer } from "@/lib/utils/stream";
import { type AdaptiveFormatItem, type SabrConfig } from "@/types";
import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat } from "googlevideo/utils";

function adaptiveFormatToSabrFormat(format: AdaptiveFormatItem) {
  return buildSabrFormat({
    itag: format.itag,
    lastModified: String(format.lastModified),
    xtags: format.xtags,
    width: format.width,
    height: format.height,
    mimeType: format.mimeType,
    audioQuality: format.audioQuality,
    bitrate: format.bitrate,
    averageBitrate: format.averageBitrate,
    quality: format.quality,
    qualityLabel: format.qualityLabel ?? undefined,
    audioTrackId: format.audioTrack?.id,
    approxDurationMs: format.approxDurationMs,
    contentLength: format.contentLength,
    isDrc: false
  });
}

function collectReadableStream({ stream, expectedBytes }: {
  stream: ReadableStream<Uint8Array>;
  expectedBytes: number;
}) {
  return readStreamToBuffer({
    reader: stream.getReader(),
    expectedBytes
  });
}

function createSabrStream({ sabrConfig, fetchFn, poToken }: {
  sabrConfig: SabrConfig;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
}) {
  const sabrFormats = sabrConfig.formats.map(adaptiveFormatToSabrFormat);
  const durationMs = parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0", 10);

  return new SabrStream({
    fetch: fetchFn,
    serverAbrStreamingUrl: sabrConfig.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
    poToken: poToken || undefined,
    clientInfo: {
      clientName: sabrConfig.clientName,
      clientVersion: sabrConfig.clientVersion
    },
    formats: sabrFormats,
    durationMs
  });
}

export async function fetchVideoViaSabrStream({ sabrConfig, videoFormat, fetchFn, poToken }: {
  sabrConfig: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
}) {
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFn,
    poToken
  });
  const targetFormat = adaptiveFormatToSabrFormat(videoFormat);
  const { videoStream } = await sabrStream.start({ videoFormat: targetFormat });
  return collectReadableStream({
    stream: videoStream,
    expectedBytes: parseInt(videoFormat.contentLength, 10)
  });
}

export async function fetchAudioViaSabrStream({ sabrConfig, audioFormat, fetchFn, poToken }: {
  sabrConfig: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
}) {
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFn,
    poToken
  });
  const targetFormat = adaptiveFormatToSabrFormat(audioFormat);
  const { audioStream } = await sabrStream.start({ audioFormat: targetFormat });
  return collectReadableStream({
    stream: audioStream,
    expectedBytes: parseInt(audioFormat.contentLength, 10)
  });
}
