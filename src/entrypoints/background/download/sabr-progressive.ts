import type { DownloadResult } from "./background-downloader";
// Parallel chunked-SABR downloader. Replaces seek-through-iframe scrubbing
// with direct googlevideo POSTs at offset playerTimeMs values, threaded
// through SabrStream's state-restore path. Pattern:
//
// 1. Phase 1: bootstrap a SabrStream session with the captured trust template
//    (player-signed initial body). Read for `phase1RunMs` so the lib populates
//    initializedFormats + nextRequestPolicy. Capture state.
//
// 2. Phase 2: fan out one SabrStream per remaining offset, each calling
//    start({ state: { ...captured, playerTimeMs: offset } }). Each session
//    reads for `phaseRunMs` then closes. Concatenate phase 1 + phase 2 in
//    offset order.
//
// SabrStream's state mechanism makes the server treat each phase-2 session
// as a continuation of phase 1, bypassing the per-session media quota that
// caps a single session at ~80s of media.
import { sendProgressUpdate } from "./progress-fetch";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig } from "@/types";
import { ProgressType } from "@/types";
import { SabrStream } from "googlevideo/sabr-stream";
import { buildSabrFormat } from "googlevideo/utils";

const PHASE_RUN_MS = 25_000;
const PHASE1_RUN_MS = 20_000;
const OFFSET_STEP_MS = 60_000;
const MAX_PARALLEL = 4;

interface ChunkedTemplate {
  url: string;
  bodyBase64: string;
  capturedAt: number;
}

function adaptiveToSabrFormat(format: AdaptiveFormatItem) {
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

function makeTemplateFetch({ originalFetch, templateUrl, templateBody }: {
  originalFetch: typeof globalThis.fetch;
  templateUrl: string;
  templateBody: Uint8Array;
}): typeof globalThis.fetch {
  let calls = 0;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;

    if (calls === 1) {
      const fresh = new Uint8Array(templateBody.byteLength);
      fresh.set(templateBody);
      return originalFetch(templateUrl, {
        method: "POST",
        body: fresh,
        mode: "cors",
        credentials: "include"
      });
    }

    return originalFetch(input, init);
  };
}

async function readForDuration({ stream, runMs, signal }: {
  stream: ReadableStream<Uint8Array>;
  runMs: number;
  signal: AbortSignal;
}): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const deadline = Date.now() + runMs;
  while (Date.now() < deadline && !signal.aborted) {
    const remaining = deadline - Date.now();
    const result = await Promise.race([
      reader.read(),
      new Promise<null>(resolveTimer => setTimeout(() => resolveTimer(null), remaining))
    ]);
    if (result === null || result.done) {
      break;
    }

    if (result.value) {
      chunks.push(result.value);
      totalBytes += result.value.byteLength;
    }
  }
  try {
    await reader.cancel();
  } catch {
    // already cancelled
  }
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function fetchOffsetChunk({
  fromMs, baseState, sabrConfig, videoFormat, audioFormat, poToken, signal
}: {
  fromMs: number;
  baseState: ReturnType<SabrStream["getState"]>;
  sabrConfig: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
}) {
  const sabrFormats = sabrConfig.formats.map(adaptiveToSabrFormat);
  const stream = new SabrStream({
    fetch: globalThis.fetch.bind(globalThis),
    serverAbrStreamingUrl: sabrConfig.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
    poToken: poToken || undefined,
    clientInfo: {
      clientName: sabrConfig.clientName,
      clientVersion: sabrConfig.clientVersion
    },
    formats: sabrFormats,
    durationMs: parseInt(sabrConfig.formats[0]?.approxDurationMs ?? "0", 10)
  });

  const { videoStream, audioStream } = await stream.start({
    videoFormat: adaptiveToSabrFormat(videoFormat),
    audioFormat: adaptiveToSabrFormat(audioFormat),
    state: {
      ...baseState,
      playerTimeMs: fromMs
    }
  });

  const [videoBytes, audioBytes] = await Promise.all([
    readForDuration({
      stream: videoStream,
      runMs: PHASE_RUN_MS,
      signal
    }),
    readForDuration({
      stream: audioStream,
      runMs: PHASE_RUN_MS,
      signal
    })
  ]);
  stream.abort();
  return {
    fromMs,
    videoBytes,
    audioBytes
  };
}

export async function downloadViaSabrProgressive({
  request, signal, tabId, template
}: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  template: ChunkedTemplate;
}): Promise<DownloadResult | null> {
  const { videoId, sabrConfig: maybeConfig, videoFormat: maybeVideo, audioFormat: maybeAudio, poToken } = request;
  if (!maybeConfig || !maybeVideo || !maybeAudio) {
    return null;
  }

  const sabrConfig: SabrConfig = maybeConfig;
  const videoFormat: AdaptiveFormatItem = maybeVideo;
  const audioFormat: AdaptiveFormatItem = maybeAudio;

  const durationMs = parseInt(audioFormat.approxDurationMs ?? "0", 10);
  if (durationMs === 0) {
    return null;
  }

  const templateBody = Uint8Array.from(atob(template.bodyBase64), char => char.charCodeAt(0));

  // Phase 1: bootstrap with player-signed body, read for ~20s, capture state.
  const sabrFormats = sabrConfig.formats.map(adaptiveToSabrFormat);
  const phase1Stream = new SabrStream({
    fetch: makeTemplateFetch({
      originalFetch: globalThis.fetch.bind(globalThis),
      templateUrl: template.url,
      templateBody
    }),
    serverAbrStreamingUrl: sabrConfig.serverAbrStreamingUrl,
    videoPlaybackUstreamerConfig: sabrConfig.videoPlaybackUstreamerConfig,
    poToken: (poToken ?? "") || undefined,
    clientInfo: {
      clientName: sabrConfig.clientName,
      clientVersion: sabrConfig.clientVersion
    },
    formats: sabrFormats,
    durationMs
  });

  const phase1Streams = await phase1Stream.start({
    videoFormat: adaptiveToSabrFormat(videoFormat),
    audioFormat: adaptiveToSabrFormat(audioFormat)
  });

  const [phase1Video, phase1Audio] = await Promise.all([
    readForDuration({
      stream: phase1Streams.videoStream,
      runMs: PHASE1_RUN_MS,
      signal
    }),
    readForDuration({
      stream: phase1Streams.audioStream,
      runMs: PHASE1_RUN_MS,
      signal
    })
  ]);

  let baseState: ReturnType<SabrStream["getState"]>;
  try {
    baseState = phase1Stream.getState();
  } catch {
    phase1Stream.abort();
    return phase1Video.byteLength === 0 && phase1Audio.byteLength === 0
      ? null
      : {
        videoData: phase1Video,
        audioData: phase1Audio,
        additionalAudioTracks: []
      };
  }
  phase1Stream.abort();

  // Phase 2: parallel offset fetches starting from where phase 1 leaves off.
  const phase1ApproxMs = OFFSET_STEP_MS;
  const offsets: number[] = [];
  for (let timeMs = phase1ApproxMs; timeMs < durationMs; timeMs += OFFSET_STEP_MS) {
    offsets.push(timeMs);
  }

  const results: Array<{
    fromMs: number;
    videoBytes: Uint8Array;
    audioBytes: Uint8Array;
  } | null> = new Array(offsets.length).fill(null);
  let cursor = 0;
  let completed = 0;

  function reportProgress() {
    completed++;
    const totalSegments = offsets.length + 1;
    const fraction = Math.min(completed / totalSegments, 1);
    void sendProgressUpdate({
      videoId,
      progress: fraction,
      progressType: ProgressType.Video,
      tabId
    });
  }

  async function worker() {
    while (cursor < offsets.length && !signal.aborted) {
      const idx = cursor++;
      const fromMs = offsets[idx];
      try {
        results[idx] = await fetchOffsetChunk({
          fromMs,
          baseState,
          sabrConfig,
          videoFormat,
          audioFormat,
          poToken: poToken ?? "",
          signal
        });
      } catch {
        results[idx] = null;
      }
      reportProgress();
    }
  }

  reportProgress();
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, offsets.length || 1) }, () => worker()));

  const videoParts = [phase1Video, ...results.map(entry => entry?.videoBytes ?? new Uint8Array())];
  const audioParts = [phase1Audio, ...results.map(entry => entry?.audioBytes ?? new Uint8Array())];
  const videoData = concat(videoParts);
  const audioData = concat(audioParts);
  if (videoData.byteLength === 0 && audioData.byteLength === 0) {
    return null;
  }

  return {
    videoData,
    audioData,
    additionalAudioTracks: []
  };
}
