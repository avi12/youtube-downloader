import { readStreamToBuffer } from "@/lib/utils/stream";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";
import { SabrStream } from "googlevideo/sabr-stream";
import { Logger, LogLevel, buildSabrFormat } from "googlevideo/utils";

const sabrLogger = Logger.getInstance();
sabrLogger.setLogLevels(LogLevel.WARN, LogLevel.ERROR, LogLevel.INFO);
sabrLogger.warn = (tag: string, ...messages: unknown[]) => {
  console.error(`[WARN] [${tag}]`, ...messages);
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

export async function collectReadableStream({ stream, expectedBytes }: {
  stream: ReadableStream<Uint8Array>;
  expectedBytes: number;
}) {
  return readStreamToBuffer({
    reader: stream.getReader(),
    expectedBytes
  });
}

export function createSabrStream({ sabrConfig, fetchFn, poToken }: {
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
