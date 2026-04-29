import { readStreamToBuffer } from "@/lib/utils/stream";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";
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

export function collectReadableStream({ stream, expectedBytes }: {
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

export function makeTrustTemplateFetch({ originalFetch, templateUrl, templateBody, onCallLog }: {
  originalFetch: typeof globalThis.fetch;
  templateUrl: string;
  templateBody: Uint8Array;
  onCallLog?: (msg: string) => void;
}): typeof globalThis.fetch {
  let callCount = 0;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    callCount++;
    const callIdx = callCount;
    const targetUrl = input instanceof Request ? input.url : String(input);
    if (callIdx === 1) {
      const fresh = new Uint8Array(templateBody.byteLength);
      fresh.set(templateBody);
      onCallLog?.(`trust-template fetch #1: replaying captured body (${fresh.byteLength}B) to ${templateUrl.slice(0, 80)}`);
      const response = await originalFetch(templateUrl, {
        method: "POST",
        body: fresh,
        mode: "cors",
        credentials: "include"
      });
      onCallLog?.(`trust-template fetch #1: status=${response.status} contentType=${response.headers.get("content-type") ?? ""}`);
      return response;
    }

    onCallLog?.(`trust-template fetch #${callIdx}: lib body to ${targetUrl.slice(0, 80)}`);
    const response = await originalFetch(input, init);
    onCallLog?.(`trust-template fetch #${callIdx}: status=${response.status} contentType=${response.headers.get("content-type") ?? ""}`);
    return response;
  };
}
