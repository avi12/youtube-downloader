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

// Wraps a fetch so the first invocation discards the lib's constructed body
// and replays a captured player-signed template body instead. Lets SabrStream
// bootstrap from a player-trusted server response on Firefox, where the lib's
// own body fails attestation_required for long videos.
function makeTrustTemplateFetch({ originalFetch, templateUrl, templateBody, onCallLog }: {
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

export async function fetchVideoAudioViaSabrStreamBootstrapped({
  sabrConfig, videoFormat, audioFormat, fetchFn, poToken, templateUrl, templateBody, onCallLog
}: {
  sabrConfig: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
  templateUrl: string;
  templateBody: Uint8Array;
  onCallLog?: (msg: string) => void;
}) {
  const wrappedFetch = makeTrustTemplateFetch({
    originalFetch: fetchFn,
    templateUrl,
    templateBody,
    onCallLog
  });
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFn: wrappedFetch,
    poToken
  });
  const videoTarget = adaptiveFormatToSabrFormat(videoFormat);
  const audioTarget = adaptiveFormatToSabrFormat(audioFormat);
  const { videoStream, audioStream } = await sabrStream.start({
    videoFormat: videoTarget,
    audioFormat: audioTarget
  });
  const [videoBytes, audioBytes] = await Promise.all([
    collectReadableStream({
      stream: videoStream,
      expectedBytes: parseInt(videoFormat.contentLength, 10)
    }),
    collectReadableStream({
      stream: audioStream,
      expectedBytes: parseInt(audioFormat.contentLength, 10)
    })
  ]);
  return {
    videoBytes,
    audioBytes
  };
}

export async function fetchAudioViaSabrStream({ sabrConfig, audioFormat, fetchFn, poToken, refreshToken }: {
  sabrConfig: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
  refreshToken?: RefreshPoToken;
}) {
  const sabrStream = createSabrStream({
    sabrConfig,
    fetchFn,
    poToken
  });
  const refreshInterval = refreshToken ? startPoTokenRefreshLoop(sabrStream, refreshToken) : null;
  try {
    const { audioStream } = await sabrStream.start({
      audioFormat: adaptiveFormatToSabrFormat(audioFormat),
      maxRetries: 10
    });
    return await collectReadableStream({
      stream: audioStream,
      expectedBytes: parseInt(audioFormat.contentLength, 10)
    });
  } finally {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }
  }
}
