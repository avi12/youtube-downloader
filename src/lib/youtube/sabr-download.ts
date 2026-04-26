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

async function readWithDeadline(reader: ReadableStreamDefaultReader<Uint8Array>, deadline: number, label: string) {
  let bytes = 0;
  let chunkCount = 0;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    try {
      const result = await Promise.race([
        reader.read(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), remainingMs))
      ]);
      if (result === null) {
        break;
      }

      if (result.done) {
        break;
      }

      if (result.value) {
        bytes += result.value.byteLength;
        chunkCount++;
      }
    } catch (error) {
      console.log(`[ytdl:debug-ranged] ${label} read threw: ${error instanceof Error ? error.message : error}`);
      break;
    }
  }
  try {
    await reader.cancel();
  } catch { /* already cancelled */ }
  console.log(`[ytdl:debug-ranged] ${label} chunks=${chunkCount} bytes=${bytes}`);
  return bytes;
}

function makeLoggedFetch(fetchFn: typeof globalThis.fetch, phase: string) {
  let reqCount = 0;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    reqCount++;
    const reqId = reqCount;
    const url = input instanceof Request ? input.url : String(input);
    console.log(`[ytdl:debug-ranged] ${phase}.fetch#${reqId} ${url.slice(0, 100)}`);
    try {
      const response = await fetchFn(input, init);
      console.log(`[ytdl:debug-ranged] ${phase}.fetch#${reqId} → ${response.status} ${response.headers.get("content-type") ?? ""}`);
      return response;
    } catch (error) {
      console.log(`[ytdl:debug-ranged] ${phase}.fetch#${reqId} threw: ${error instanceof Error ? error.message : error}`);
      throw error;
    }
  };
}

// Two-phase experiment: does the SABR server accept a session jumped ahead to
// playerTimeMs > 0? Phase 1 starts normally at t=0 and reads briefly to let
// the library accumulate server-issued state (initializedFormats, playback
// cookie, etc.). Phase 2 creates a fresh stream and calls start({ state, ... })
// with the captured state but playerTimeMs overwritten to `fromMs`. If phase 2
// returns bytes, chunked-SABR is viable. If phase 2 gets 403 or attestation,
// the seek is rejected and chunking won't bypass the long-video wall.
export async function debugRangedSabr({
  sabrConfig, videoFormat, audioFormat, fetchFn, poToken, fromMs, runMs
}: {
  sabrConfig: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  fetchFn: typeof globalThis.fetch;
  poToken: string;
  fromMs: number;
  runMs: number;
}) {
  const durationMs = parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0", 10);
  console.log(`[ytdl:debug-ranged] start fromMs=${fromMs} runMs=${runMs} durationMs=${durationMs}`);

  const videoTarget = adaptiveFormatToSabrFormat(videoFormat);
  const audioTarget = adaptiveFormatToSabrFormat(audioFormat);

  // Phase 1: normal start to accumulate state.
  const phase1 = createSabrStream({
    sabrConfig,
    fetchFn: makeLoggedFetch(fetchFn, "phase1"),
    poToken
  });
  const phase1Streams = await phase1.start({
    videoFormat: videoTarget,
    audioFormat: audioTarget
  });

  const phase1Deadline = Date.now() + 5000;
  await Promise.all([
    readWithDeadline(phase1Streams.videoStream.getReader(), phase1Deadline, "phase1-video"),
    readWithDeadline(phase1Streams.audioStream.getReader(), phase1Deadline, "phase1-audio")
  ]);

  let capturedState;
  try {
    capturedState = phase1.getState();
    console.log(`[ytdl:debug-ranged] phase1 state captured playerTimeMs=${capturedState.playerTimeMs} formats=${capturedState.initializedFormats.length}`);
  } catch (error) {
    console.log(`[ytdl:debug-ranged] phase1 getState threw: ${error instanceof Error ? error.message : error}`);
    return {
      phase1Succeeded: false,
      phase2Succeeded: false,
      fromMs,
      runMs
    };
  }

  // Phase 2: fresh stream, replay captured state with playerTimeMs jumped.
  const jumpedState = {
    ...capturedState,
    playerTimeMs: fromMs
  };
  const phase2 = createSabrStream({
    sabrConfig,
    fetchFn: makeLoggedFetch(fetchFn, "phase2"),
    poToken
  });
  const phase2Streams = await phase2.start({
    videoFormat: videoTarget,
    audioFormat: audioTarget,
    state: jumpedState
  });

  const phase2Deadline = Date.now() + runMs;
  const [videoBytes, audioBytes] = await Promise.all([
    readWithDeadline(phase2Streams.videoStream.getReader(), phase2Deadline, "phase2-video"),
    readWithDeadline(phase2Streams.audioStream.getReader(), phase2Deadline, "phase2-audio")
  ]);

  console.log(`[ytdl:debug-ranged] DONE fromMs=${fromMs} phase2Video=${videoBytes} phase2Audio=${audioBytes}`);
  return {
    phase1Succeeded: true,
    phase2Succeeded: videoBytes > 0 || audioBytes > 0,
    videoBytes,
    audioBytes,
    fromMs,
    runMs
  };
}
