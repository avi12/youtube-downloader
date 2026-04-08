import { sabrCredentials } from "@/lib/synced-stores.svelte";
import { type AdaptiveFormatItem, type VideoData } from "@/types";
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

async function collectReadableStream(stream: ReadableStream<Uint8Array>) {
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

// On watch pages, YouTube's Service Worker handles CORS for googlevideo.com.
function createSabrStream(
  sabrConfig: NonNullable<VideoData["sabrConfig"]>,
  originalFetch: typeof globalThis.fetch,
  capturedPoToken: string
) {
  const sabrFormats = sabrConfig.formats.map(adaptiveFormatToSabrFormat);
  const durationMs = parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0", 10);

  return new SabrStream({
    fetch: originalFetch,
    serverAbrStreamingUrl: sabrConfig.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
    poToken: capturedPoToken || sabrCredentials.value?.poToken || undefined,
    clientInfo: {
      clientName: sabrConfig.clientName,
      clientVersion: sabrConfig.clientVersion
    },
    formats: sabrFormats,
    durationMs
  });
}

export async function fetchViaSabrStream(
  sabrConfig: NonNullable<VideoData["sabrConfig"]>,
  videoFormat: AdaptiveFormatItem,
  audioFormat: AdaptiveFormatItem,
  originalFetch: typeof globalThis.fetch,
  capturedPoToken: string
) {
  const sabrStream = createSabrStream(sabrConfig, originalFetch, capturedPoToken);

  const { videoStream, audioStream } = await sabrStream.start({
    videoFormat: adaptiveFormatToSabrFormat(videoFormat),
    audioFormat: adaptiveFormatToSabrFormat(audioFormat)
  });

  const [videoData, audioData] = await Promise.all([
    collectReadableStream(videoStream),
    collectReadableStream(audioStream)
  ]);

  return { videoData, audioData };
}

export async function fetchAudioViaSabrStream(
  sabrConfig: NonNullable<VideoData["sabrConfig"]>,
  audioFormat: AdaptiveFormatItem,
  originalFetch: typeof globalThis.fetch,
  capturedPoToken: string
) {
  const sabrStream = createSabrStream(sabrConfig, originalFetch, capturedPoToken);

  const targetFormat = adaptiveFormatToSabrFormat(audioFormat);
  const { audioStream } = await sabrStream.start({ audioFormat: targetFormat });
  return collectReadableStream(audioStream);
}
