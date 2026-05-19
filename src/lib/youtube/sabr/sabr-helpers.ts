import { StreamStallError, readStreamToBuffer } from "@/lib/utils/stream";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";
import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat } from "googlevideo/utils";

export type SabrStreamResult = {
  data: Uint8Array;
  isComplete: boolean;
};

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

type CollectReadableStreamParams = {
  stream: ReadableStream<Uint8Array>;
  expectedBytes: number;
  signal?: AbortSignal;
  onChunk?: (chunk: Uint8Array) => void;
};
export async function collectReadableStream({ stream, expectedBytes, signal, onChunk }: CollectReadableStreamParams) {
  const reader = stream.getReader();
  const isAborted = signal?.aborted;
  if (isAborted) {
    void reader.cancel();
  } else {
    signal?.addEventListener("abort", () => void reader.cancel(), { once: true });
  }

  try {
    const data = await readStreamToBuffer({
      reader,
      expectedBytes,
      onChunk
    });
    return {
      data,
      isComplete: true
    };
  } catch (error) {
    const isStallError = error instanceof StreamStallError;
    if (isStallError) {
      return {
        data: error.partialData,
        isComplete: false
      };
    }

    throw error;
  }
}

type CreateSabrStreamParams = {
  sabrConfig: SabrConfig;
  fetchFunction: typeof globalThis.fetch;
  poToken: string;
};
export function createSabrStream({ sabrConfig, fetchFunction, poToken }: CreateSabrStreamParams) {
  return new SabrStream({
    fetch: fetchFunction,
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
