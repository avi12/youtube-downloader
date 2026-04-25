// Offline SABR replay harness. Loads a captured trust-template body + URL
// from disk, iterates the protocol against googlevideo manually, decodes each
// response, and reports where iteration stalls and why.
//
// Why raw-protocol instead of SabrStream lib: the lib hides the actual
// per-request signal (was the response control-only? did the server set
// backoffTimeMs? did it send SABR_ERROR?). At ~fetch #11 the lib appears to
// hang and we need to see what the server is actually saying.
//
// Usage:
//   1. In the user's Firefox tab console (with extension loaded) run:
//        copy(JSON.stringify({
//          url: window.__ytdlSabrTemplate.url,
//          bodyBase64: btoa(String.fromCharCode(...window.__ytdlSabrTemplate.body)),
//          capturedAt: window.__ytdlSabrTemplate.capturedAt
//        }))
//      then paste into scripts/captured-template.json
//   2. Run: bun scripts/sabr-replay-harness.ts
//
// The harness mirrors what SabrStream does internally but with full visibility:
// per-iteration timing, per-fetch timeout, decoded MEDIA_HEADER /
// NEXT_REQUEST_POLICY / SABR_ERROR / STREAM_PROTECTION_STATUS parts. Stop
// conditions: SABR_ERROR, 0 media bytes, hard timeout, or N iterations.
import {
  ClientAbrState,
  FormatInitializationMetadata,
  MediaHeader,
  NextRequestPolicy,
  PlaybackCookie,
  SabrError,
  StreamProtectionStatus,
  UMPPartId,
  VideoPlaybackAbrRequest
} from "googlevideo/protos";
import { CompositeBuffer, UmpReader } from "googlevideo/ump";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface CapturedTemplate {
  url: string;
  bodyBase64: string;
  capturedAt: number;
}

interface IterationResult {
  iter: number;
  status: number;
  bytes: number;
  durationMs: number;
  mediaBytes: number;
  segmentsByItag: Record<number, {
    count: number;
    sumDurationMs: number;
    firstSeq: number;
    lastSeq: number;
  }>;
  formatInitsByItag: number[];
  hadNextRequestPolicy: boolean;
  backoffMs?: number;
  sabrError?: {
    type?: string;
    code?: number;
  };
  protectionStatus?: number;
  unrecognizedParts: string[];
}

const TEMPLATE_PATH = resolve("scripts/captured-template.json");
const PER_FETCH_TIMEOUT_MS = 30_000;
const MAX_ITERATIONS = 30;

function decodeBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function compositeBufferToUint8(buffer: CompositeBuffer): Uint8Array {
  const out = new Uint8Array(buffer.totalLength);
  let offset = 0;
  for (const chunk of buffer.chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

interface DecodedResponse {
  mediaHeaders: MediaHeader[];
  formatInits: FormatInitializationMetadata[];
  nextRequestPolicy?: NextRequestPolicy;
  sabrError?: SabrError;
  protectionStatus?: StreamProtectionStatus;
  mediaBytesByHeaderId: Map<number, number>;
  partCounts: Record<string, number>;
  unrecognizedParts: Set<string>;
}

function decodeResponse(body: Uint8Array): DecodedResponse {
  const decoded: DecodedResponse = {
    mediaHeaders: [],
    formatInits: [],
    mediaBytesByHeaderId: new Map(),
    partCounts: {},
    unrecognizedParts: new Set()
  };

  const reader = new UmpReader(new CompositeBuffer([body]));
  reader.read((part: {
    type: number;
    size: number;
    data: CompositeBuffer;
  }) => {
    const partName = UMPPartId[part.type] ?? `unknown(${part.type})`;
    decoded.partCounts[partName] = (decoded.partCounts[partName] ?? 0) + 1;
    const bytes = compositeBufferToUint8(part.data);
    try {
      switch (part.type) {
        case UMPPartId.MEDIA_HEADER:
          decoded.mediaHeaders.push(MediaHeader.decode(bytes));
          break;
        case UMPPartId.MEDIA: {
          const headerId = bytes[0];
          if (typeof headerId === "number") {
            const prior = decoded.mediaBytesByHeaderId.get(headerId) ?? 0;
            decoded.mediaBytesByHeaderId.set(headerId, prior + bytes.byteLength - 1);
          }

          break;
        }
        case UMPPartId.MEDIA_END:
          break;
        case UMPPartId.FORMAT_INITIALIZATION_METADATA:
          decoded.formatInits.push(FormatInitializationMetadata.decode(bytes));
          break;
        case UMPPartId.NEXT_REQUEST_POLICY:
          decoded.nextRequestPolicy = NextRequestPolicy.decode(bytes);
          break;
        case UMPPartId.SABR_ERROR:
          decoded.sabrError = SabrError.decode(bytes);
          break;
        case UMPPartId.STREAM_PROTECTION_STATUS:
          decoded.protectionStatus = StreamProtectionStatus.decode(bytes);
          break;
        default:
          decoded.unrecognizedParts.add(partName);
      }
    } catch (decodeErr) {
      console.warn(`[harness] decode ${partName} threw: ${String(decodeErr)}`);
    }
  });

  return decoded;
}

interface SessionState {
  playerTimeMs: number;
  requestNumber: number;
  playbackCookieBytes?: Uint8Array;
  bufferedRanges: VideoPlaybackAbrRequest["bufferedRanges"];
  totalDurationByItag: Map<number, number>;
  lastSegByItag: Map<number, number>;
  firstSegByItag: Map<number, number>;
}

function fetchWithTimeout(url: string, body: Uint8Array, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const buffer = new ArrayBuffer(body.byteLength);
  new Uint8Array(buffer).set(body);
  return fetch(url, {
    method: "POST",
    body: buffer,
    credentials: "include",
    signal: controller.signal
  }).finally(() => clearTimeout(timeout));
}

function buildNextBody(decodedTemplate: VideoPlaybackAbrRequest, state: SessionState): Uint8Array {
  const newAbrState: ClientAbrState = {
    ...(decodedTemplate.clientAbrState ?? {}),
    playerTimeMs: String(state.playerTimeMs)
  };

  const next: VideoPlaybackAbrRequest = {
    ...decodedTemplate,
    clientAbrState: newAbrState,
    bufferedRanges: state.bufferedRanges,
    streamerContext: {
      ...(decodedTemplate.streamerContext ?? {
        sabrContexts: [],
        unsentSabrContexts: [],
        clientInfo: undefined
      }),
      playbackCookie: state.playbackCookieBytes
    }
  };

  return VideoPlaybackAbrRequest.encode(next).finish();
}

function urlWithRequestNumber(baseUrl: string, requestNumber: number) {
  const url = new URL(baseUrl);
  url.searchParams.set("rn", String(requestNumber));
  return url.toString();
}

function summarizeIteration(result: IterationResult) {
  const segLines = Object.entries(result.segmentsByItag)
    .map(([itag, info]) => `itag=${itag} segs=${info.count} dur=${info.sumDurationMs}ms range=[${info.firstSeq}..${info.lastSeq}]`)
    .join("; ");
  const tags: string[] = [];
  if (result.formatInitsByItag.length) {
    tags.push(`init=${result.formatInitsByItag.join(",")}`);
  }

  if (result.hadNextRequestPolicy) {
    tags.push(`nrp${result.backoffMs ? `(backoff=${result.backoffMs}ms)` : ""}`);
  }

  if (result.protectionStatus !== undefined) {
    tags.push(`protectionStatus=${result.protectionStatus}`);
  }

  if (result.sabrError) {
    tags.push(`SABR_ERROR type=${result.sabrError.type} code=${result.sabrError.code}`);
  }

  if (result.unrecognizedParts.length) {
    tags.push(`unknown=${result.unrecognizedParts.join(",")}`);
  }

  console.log(
    `[iter ${String(result.iter).padStart(2)}] status=${result.status} bytes=${result.bytes} `
    + `media=${result.mediaBytes}B in ${result.durationMs}ms ${tags.join(" ")} ${segLines}`
  );
}

async function main() {
  let template: CapturedTemplate;
  try {
    const raw = readFileSync(TEMPLATE_PATH, "utf8");
    template = JSON.parse(raw);
  } catch (err) {
    console.error(`failed to load ${TEMPLATE_PATH}: ${String(err)}`);
    console.error("capture a template by running this in the user's Firefox tab console:");
    console.error("  copy(JSON.stringify({url:window.__ytdlSabrTemplate.url,bodyBase64:btoa(String.fromCharCode(...window.__ytdlSabrTemplate.body)),capturedAt:window.__ytdlSabrTemplate.capturedAt}))");
    process.exit(1);
  }

  const ageMs = Date.now() - template.capturedAt;
  console.log(`template: url=${template.url.slice(0, 90)}…`);
  console.log(`body=${template.bodyBase64.length} chars (b64) age=${ageMs}ms`);

  const bodyBytes = decodeBase64(template.bodyBase64);
  const decodedTemplate = VideoPlaybackAbrRequest.decode(bodyBytes);
  const audioFormatId = decodedTemplate.selectedFormatIds[0];
  const videoFormatId = decodedTemplate.selectedFormatIds[1];
  console.log(
    `decoded: audioItag=${audioFormatId?.itag} videoItag=${videoFormatId?.itag} `
    + `playerTimeMs=${decodedTemplate.clientAbrState?.playerTimeMs} `
    + `bufferedRanges=${decodedTemplate.bufferedRanges.length}`
  );

  const state: SessionState = {
    playerTimeMs: parseInt(decodedTemplate.clientAbrState?.playerTimeMs ?? "0", 10) || 0,
    requestNumber: 0,
    bufferedRanges: decodedTemplate.bufferedRanges,
    totalDurationByItag: new Map(),
    lastSegByItag: new Map(),
    firstSegByItag: new Map()
  };

  let consecutiveEmpty = 0;
  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    const requestBody = iter === 1 ? bodyBytes : buildNextBody(decodedTemplate, state);
    const url = iter === 1 ? template.url : urlWithRequestNumber(template.url, state.requestNumber);
    const start = Date.now();
    let status: number;
    let responseBytes: Uint8Array;
    try {
      const response = await fetchWithTimeout(url, requestBody, PER_FETCH_TIMEOUT_MS);
      status = response.status;
      responseBytes = new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      console.error(`[iter ${iter}] fetch threw: ${String(err)}`);
      break;
    }
    const durationMs = Date.now() - start;

    const decoded = decodeResponse(responseBytes);
    const totalMediaBytes = [...decoded.mediaBytesByHeaderId.values()].reduce((sum, count) => sum + count, 0);

    const segmentsByItag: IterationResult["segmentsByItag"] = {};
    for (const header of decoded.mediaHeaders) {
      const itag = header.itag ?? 0;
      const seq = header.sequenceNumber ?? 0;
      const segDuration = parseInt(header.durationMs ?? "0", 10) || 0;
      if (!segmentsByItag[itag]) {
        segmentsByItag[itag] = {
          count: 0,
          sumDurationMs: 0,
          firstSeq: seq,
          lastSeq: seq
        };
      }

      const entry = segmentsByItag[itag];
      entry.count++;
      entry.sumDurationMs += segDuration;
      entry.lastSeq = Math.max(entry.lastSeq, seq);
      entry.firstSeq = Math.min(entry.firstSeq, seq);
      state.totalDurationByItag.set(itag, (state.totalDurationByItag.get(itag) ?? 0) + segDuration);
      state.lastSegByItag.set(itag, Math.max(state.lastSegByItag.get(itag) ?? 0, seq));

      if (!state.firstSegByItag.has(itag)) {
        state.firstSegByItag.set(itag, seq);
      }
    }

    const result: IterationResult = {
      iter,
      status,
      bytes: responseBytes.byteLength,
      durationMs,
      mediaBytes: totalMediaBytes,
      segmentsByItag,
      formatInitsByItag: decoded.formatInits.map(format => format.formatId?.itag ?? 0),
      hadNextRequestPolicy: Boolean(decoded.nextRequestPolicy),
      backoffMs: decoded.nextRequestPolicy?.backoffTimeMs,
      sabrError: decoded.sabrError,
      protectionStatus: decoded.protectionStatus?.status,
      unrecognizedParts: [...decoded.unrecognizedParts]
    };
    summarizeIteration(result);

    if (decoded.sabrError) {
      console.error(`[harness] STOP: SABR_ERROR type=${decoded.sabrError.type} code=${decoded.sabrError.code}`);
      break;
    }

    if (decoded.protectionStatus?.status === 3) {
      console.error("[harness] STOP: STREAM_PROTECTION_STATUS=3 (attestation_required)");
      break;
    }

    if (totalMediaBytes === 0) {
      consecutiveEmpty++;

      if (consecutiveEmpty >= 3) {
        console.error("[harness] STOP: 3 consecutive empty responses (server quota wall)");
        break;
      }
    } else {
      consecutiveEmpty = 0;
    }

    if (decoded.nextRequestPolicy?.playbackCookie) {
      state.playbackCookieBytes = PlaybackCookie.encode(decoded.nextRequestPolicy.playbackCookie).finish();
    }

    if (decoded.nextRequestPolicy?.backoffTimeMs && decoded.nextRequestPolicy.backoffTimeMs > 0) {
      console.log(`[harness] respecting backoff=${decoded.nextRequestPolicy.backoffTimeMs}ms`);
      await new Promise(resolveTimer => setTimeout(resolveTimer, decoded.nextRequestPolicy?.backoffTimeMs ?? 0));
    }

    state.requestNumber++;
    rebuildBufferedRanges(state, decodedTemplate);
    advancePlayerTime(state);
  }

  console.log(
    `\n[harness] DONE. cumulative duration by itag: `
    + [...state.totalDurationByItag.entries()].map(([itag, d]) => `${itag}=${d}ms`).join(", ")
  );
}

function rebuildBufferedRanges(state: SessionState, template: VideoPlaybackAbrRequest) {
  const newRanges: VideoPlaybackAbrRequest["bufferedRanges"] = [];
  for (const [itag, totalDuration] of state.totalDurationByItag.entries()) {
    const formatId = template.selectedFormatIds.find(item => item.itag === itag);
    if (!formatId) {
      continue;
    }

    newRanges.push({
      formatId,
      startTimeMs: "0",
      durationMs: String(totalDuration),
      startSegmentIndex: state.firstSegByItag.get(itag) ?? 1,
      endSegmentIndex: state.lastSegByItag.get(itag) ?? 1
    });
  }
  state.bufferedRanges = newRanges;
}

function advancePlayerTime(state: SessionState) {
  let minDuration = Number.POSITIVE_INFINITY;
  for (const duration of state.totalDurationByItag.values()) {
    minDuration = Math.min(minDuration, duration);
  }

  if (Number.isFinite(minDuration)) {
    state.playerTimeMs = minDuration;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
