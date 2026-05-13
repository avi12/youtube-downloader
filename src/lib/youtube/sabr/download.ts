import { StreamStallError, readStreamToBuffer } from "@/lib/utils/stream";
import { type AdaptiveFormatItem, type SabrConfig } from "@/types";
import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat } from "googlevideo/utils";

export type SabrStreamResult = {
  data: Uint8Array;
  isComplete: boolean;
};

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

function collectReadableStream({ stream, expectedBytes, signal }: {
  stream: ReadableStream<Uint8Array>;
  expectedBytes: number;
  signal?: AbortSignal;
}): Promise<SabrStreamResult> {
  const reader = stream.getReader();
  if (signal?.aborted) {
    void reader.cancel();
  } else {
    signal?.addEventListener("abort", () => void reader.cancel(), { once: true });
  }

  return readStreamToBuffer({
    reader,
    expectedBytes
  }).then(
    data => ({
      data,
      isComplete: true
    }),
    error => {
      if (error instanceof StreamStallError) {
        return {
          data: error.partialData,
          isComplete: false
        };
      }

      throw error;
    }
  );
}

function createSabrStream({ sabrConfig, fetchFn, poToken }: {
  sabrConfig: SabrConfig;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
}) {
  return new SabrStream({
    fetch: fetchFn,
    serverAbrStreamingUrl: sabrConfig.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
    poToken: poToken || undefined,
    clientInfo: {
      clientName: sabrConfig.clientName,
      clientVersion: sabrConfig.clientVersion
    },
    formats: sabrConfig.formats.map(adaptiveFormatToSabrFormat),
    durationMs: parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0", 10)
  });
}

export async function fetchVideoViaSabrStream({ sabrConfig, videoFormat, fetchFn, poToken, signal }: {
  sabrConfig: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
  signal?: AbortSignal;
}): Promise<SabrStreamResult> {
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFn,
    poToken
  });
  const { videoStream } = await sabrStream.start({
    videoFormat: adaptiveFormatToSabrFormat(videoFormat),
    maxRetries: 2
  });
  return collectReadableStream({
    stream: videoStream,
    expectedBytes: parseInt(videoFormat.contentLength, 10),
    signal
  });
}

export async function fetchAudioViaSabrStream({ sabrConfig, audioFormat, fetchFn, poToken, signal }: {
  sabrConfig: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
  signal?: AbortSignal;
}): Promise<SabrStreamResult> {
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFn,
    poToken
  });
  const { audioStream } = await sabrStream.start({
    audioFormat: adaptiveFormatToSabrFormat(audioFormat),
    maxRetries: 2
  });
  return collectReadableStream({
    stream: audioStream,
    expectedBytes: parseInt(audioFormat.contentLength, 10),
    signal
  });
}
