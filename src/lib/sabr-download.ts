import { type AdaptiveFormatItem, type SabrConfig } from "@/types";
import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat } from "googlevideo/utils";

export function adaptiveFormatToSabrFormat(format: AdaptiveFormatItem) {
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

export async function collectReadableStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    totalBytes += value.byteLength;
  }

  const result = new Uint8Array(totalBytes);
  let writeOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.byteLength;
  }

  return result;
}

export function createSabrStream(
  sabrConfig: SabrConfig,
  fetchFn: typeof globalThis.fetch,
  poToken: string
) {
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

export async function fetchVideoViaSabrStream(
  sabrConfig: SabrConfig,
  videoFormat: AdaptiveFormatItem,
  fetchFn: typeof globalThis.fetch,
  poToken: string
) {
  const sabrStream = createSabrStream(sabrConfig, fetchFn, poToken);
  const targetFormat = adaptiveFormatToSabrFormat(videoFormat);
  const { videoStream } = await sabrStream.start({ videoFormat: targetFormat });
  return collectReadableStream(videoStream);
}

export async function fetchAudioViaSabrStream(
  sabrConfig: SabrConfig,
  audioFormat: AdaptiveFormatItem,
  fetchFn: typeof globalThis.fetch,
  poToken: string
) {
  const sabrStream = createSabrStream(sabrConfig, fetchFn, poToken);
  const targetFormat = adaptiveFormatToSabrFormat(audioFormat);
  const { audioStream } = await sabrStream.start({ audioFormat: targetFormat });
  return collectReadableStream(audioStream);
}
