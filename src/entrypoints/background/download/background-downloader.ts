import { ensureProcessor } from "../handlers/processor";
import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { downloadViaCdn } from "./cdn-downloader";
import { downloadViaSabr } from "./sabr-downloader";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { interruptedDownloadsItem, mutateStorageItem } from "@/lib/storage/storage";
import { TRANSFER_CHUNK_SIZE, uint8ToBase64 } from "@/lib/utils/binary";
import { fetchYouTubeMusicMetadata } from "@/lib/youtube/youtube-music-metadata";
import { ProgressType, StreamType } from "@/types";
import type { DownloadRequest, VideoMetadata } from "@/types";

export interface DownloadResult {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  additionalAudioTracks: Array<{
    data: Uint8Array | null;
    mimeType: string;
    label: string;
  }>;
}

const activeBackgroundDownloads = new Map<string, AbortController>();

// How long SABR can go without delivering any bytes before falling back to CDN.
// A stall (no bytes received) is distinct from a slow connection: slow downloads
// keep resetting this timer and are never killed, while a frozen SABR session
// (re-downloading a recently-fetched video) gets detected and CDN is tried.
const SABR_STALL_TIMEOUT_MS = 30_000;
const pendingNetworkRetries = new Map<string, {
  request: DownloadRequest;
  tabId: number;
}>();

addEventListener("online", () => {
  const retries = [...pendingNetworkRetries.values()];
  pendingNetworkRetries.clear();
  for (const { request, tabId } of retries) {
    void startBackgroundDownload({
      request,
      tabId
    });
  }
});

async function persistInterruptedDownload(request: DownloadRequest) {
  await mutateStorageItem(interruptedDownloadsItem, current => {
    current[request.videoId] = {
      videoId: request.videoId,
      type: request.type,
      filenameOutput: request.filenameOutput,
      videoItag: request.videoItag,
      audioItag: request.audioItag,
      timestamp: Date.now()
    };
  });
}

async function clearInterruptedDownload(videoId: string) {
  await mutateStorageItem(interruptedDownloadsItem, current => {
    delete current[videoId];
  });
}

const YIELD_EVERY_N_CHUNKS = 32;

async function sendStreamChunksToOffscreen({ videoId, streamType, data, tabId }: {
  videoId: string;
  streamType: string;
  data: Uint8Array;
  tabId: number;
}) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      videoId,
      streamType,
      iChunk,
      totalChunks,
      chunkBase64: uint8ToBase64(chunk),
      tabId
    });

    if ((iChunk + 1) % YIELD_EVERY_N_CHUNKS === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

async function dispatchToOffscreen({ request, result, enrichedMetadata, tabId }: {
  request: DownloadRequest;
  result: DownloadResult;
  enrichedMetadata: VideoMetadata | null | undefined;
  tabId: number;
}) {
  await ensureProcessor();

  const resolvedVideoMimeType = request.videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
  const resolvedAudioMimeType = request.audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";
  const transferJobs: Promise<void>[] = [];
  if (result.videoData) {
    transferJobs.push(
      sendStreamChunksToOffscreen({
        videoId: request.videoId,
        streamType: StreamType.Video,
        data: result.videoData,
        tabId
      })
    );
  }

  if (result.audioData) {
    transferJobs.push(
      sendStreamChunksToOffscreen({
        videoId: request.videoId,
        streamType: StreamType.Audio,
        data: result.audioData,
        tabId
      })
    );
  }

  for (const [i, track] of result.additionalAudioTracks.entries()) {
    if (track.data) {
      transferJobs.push(
        sendStreamChunksToOffscreen({
          videoId: request.videoId,
          streamType: `audio-extra-${i}`,
          data: track.data,
          tabId
        })
      );
    }
  }

  await Promise.all(transferJobs);

  const audioTrackLabels = [
    request.primaryAudioLabel ?? "",
    ...result.additionalAudioTracks.map(track => track.label)
  ];

  sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
    type: request.type,
    videoId: request.videoId,
    filenameOutput: request.filenameOutput,
    videoMimeType: resolvedVideoMimeType,
    audioMimeType: resolvedAudioMimeType,
    audioTrackLabels,
    tabId,
    playlistId: request.playlistId,
    playlistTitle: request.playlistTitle,
    playlistTotalCount: request.playlistTotalCount,
    metadata: enrichedMetadata
  });
}

async function enrichMetadataFromYouTubeMusic(metadata: VideoMetadata | null | undefined) {
  if (!metadata?.isMusic) {
    return metadata;
  }

  const searchQuery = `${metadata.artist} ${metadata.title}`.trim();
  if (!searchQuery) {
    return metadata;
  }

  return fetchYouTubeMusicMetadata({
    searchQuery,
    existingMetadata: metadata
  });
}

function reportDownloadFailed({ videoId, tabId }: {
  videoId: string;
  tabId: number;
}) {
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isFailed: true
  }, tabId);
  void removeFromPopupList(videoId);
  signalVideoComplete(videoId);
}

function queueNetworkRetry({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  pendingNetworkRetries.set(request.videoId, {
    request,
    tabId
  });
  void persistInterruptedDownload(request);
}

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
}

const OWN_SABR_TRACE_KEY = "ytdlOwnSabrTrace";
const OWN_SABR_TRACE_MAX_ENTRIES = 200;

async function writeOwnSabrTrace(entry: Record<string, unknown>, tabId?: number) {
  try {
    const current = await browser.storage.local.get(OWN_SABR_TRACE_KEY);
    const trace = Array.isArray(current[OWN_SABR_TRACE_KEY]) ? current[OWN_SABR_TRACE_KEY] as unknown[] : [];
    trace.push({ t: Date.now(), ...entry });
    if (trace.length > OWN_SABR_TRACE_MAX_ENTRIES) {
      trace.splice(0, trace.length - OWN_SABR_TRACE_MAX_ENTRIES);
    }

    await browser.storage.local.set({ [OWN_SABR_TRACE_KEY]: trace });
  } catch {}

  if (typeof tabId === "number" && tabId >= 0) {
    try {
      const serializedEntry = Object.entries(entry).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
      await sendMessage(MessageType.BgDebugLog, {
        msg: `own-sabr ${serializedEntry}`
      }, tabId);
    } catch {}
  }
}

async function runFirefoxOwnSabr({ request, tabId, signal }: {
  request: DownloadRequest;
  tabId: number;
  signal: AbortSignal;
}): Promise<DownloadResult | null> {
  const { getCapturedSabrData, extractPreferredFormatItagsFromBody } = await import("@/lib/youtube/sabr-request-capture");
  const { firefoxSabrSingleFetch, assembleMediaByFormat, spliceBodyWithPlaybackCookie, spliceBodyWithState } = await import("@/lib/youtube/firefox-sabr");

  await writeOwnSabrTrace({ phase: "enter", videoId: request.videoId }, tabId);
  const captured = getCapturedSabrData(tabId);
  if (!captured) {
    await writeOwnSabrTrace({ phase: "no-captured" }, tabId);
    return null;
  }

  const itags = extractPreferredFormatItagsFromBody(captured.body);
  if (itags.video[0] === undefined || itags.audio[0] === undefined) {
    await writeOwnSabrTrace({ phase: "no-itags" }, tabId);
    return null;
  }

  let body = new Uint8Array(captured.body);
  const collectedByItag = new Map<number, Map<number, Uint8Array>>();
  interface BufferedBatch {
    itag: number;
    startMs: number;
    durationMs: number;
    startSegmentIndex: number;
    endSegmentIndex: number;
  }
  const bufferedBatches: BufferedBatch[] = [];

  function contentLengthOf(itag: number) {
    return parseInt(request.sabrConfig?.formats.find(f => f.itag === itag)?.contentLength ?? "0", 10);
  }

  function isAudioItag(itag: number) {
    return request.sabrConfig?.formats.find(f => f.itag === itag)?.mimeType.startsWith("audio/") ?? false;
  }

  let videoItag = itags.video[0];
  let audioItag = itags.audio[0];
  let videoExpected = contentLengthOf(videoItag);
  let audioExpected = contentLengthOf(audioItag);

  const MAX_ITERATIONS = 200;
  const NO_PROGRESS_LIMIT = 10;
  const baseUrl = new URL(captured.url);
  let noProgressIterations = 0;
  await writeOwnSabrTrace({
    phase: "start",
    videoItag,
    audioItag,
    videoExpected,
    audioExpected,
    bodyLen: body.byteLength,
    url: baseUrl.href.slice(0, 120)
  }, tabId);
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (signal.aborted) {
      await writeOwnSabrTrace({ phase: "abort", iter }, tabId);
      return null;
    }

    baseUrl.searchParams.set("rn", String(iter + 1));
    const fetchResult = await firefoxSabrSingleFetch({
      url: baseUrl.href,
      body,
      signal
    }).catch(async (err: Error) => {
      await writeOwnSabrTrace({ phase: "fetch-err", iter, err: err.message }, tabId);
      return null;
    });
    if (!fetchResult) {
      return null;
    }

    const response = fetchResult.response;
    const { playbackCookie, backoffTimeMs, streamProtectionStatus, segments } = assembleMediaByFormat({
      umpBody: response,
      expectedVideoItag: videoItag,
      expectedAudioItag: audioItag
    });

    if (streamProtectionStatus >= 2) {
      const STREAM_PROTECTION_ATTESTATION_REQUIRED = 3;
      await writeOwnSabrTrace({
        phase: "protection-status",
        iter,
        status: streamProtectionStatus
      }, tabId);
      if (streamProtectionStatus === STREAM_PROTECTION_ATTESTATION_REQUIRED) {
        let furthestEndMs = 0;
        for (const batch of bufferedBatches) {
          const end = batch.startMs + batch.durationMs;
          if (end > furthestEndMs) furthestEndMs = end;
        }

        const capturedTimestampBefore = captured.timestamp;
        const MS_PER_SECOND = 1000;
        const SEEK_LOOKAHEAD_MS = 10_000;
        void sendMessage(MessageType.AdvancePlayer, {
          targetTimeMs: Math.floor(furthestEndMs + SEEK_LOOKAHEAD_MS)
        }, tabId);
        const FRESH_CAPTURE_WAIT_MS = 3000;
        const POLL_INTERVAL_MS = 200;
        let freshCaptured = null;
        const deadline = Date.now() + FRESH_CAPTURE_WAIT_MS;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
          const current = getCapturedSabrData(tabId);
          if (current && current.timestamp > capturedTimestampBefore) {
            freshCaptured = current;
            break;
          }
        }

        if (freshCaptured) {
          body = new Uint8Array(freshCaptured.body);
          await writeOwnSabrTrace({
            phase: "session-restart-fresh-capture",
            iter,
            bodyLen: body.byteLength,
            keepingVideoItag: videoItag,
            keepingAudioItag: audioItag
          }, tabId);
        } else {
          body = new Uint8Array(captured.body);
          await writeOwnSabrTrace({
            phase: "session-restart-no-fresh",
            iter,
            fellBackToInitial: true
          }, tabId);
        }

        body = new Uint8Array(spliceBodyWithState({
          body,
          playerTimeMs: furthestEndMs,
          ranges: bufferedBatches
        }));
      }
    }

    if (segments.length > 0) {
      const servedItags = new Set(segments.map(s => s.itag));
      if (!servedItags.has(videoItag)) {
        const alternative = segments.find(s => !isAudioItag(s.itag) && s.itag !== audioItag)?.itag;
        if (alternative !== undefined) {
          videoItag = alternative;
          videoExpected = contentLengthOf(alternative);
        }
      }

      if (!servedItags.has(audioItag)) {
        const alternative = segments.find(s => isAudioItag(s.itag) && s.itag !== videoItag)?.itag;
        if (alternative !== undefined) {
          audioItag = alternative;
          audioExpected = contentLengthOf(alternative);
        }
      }
    }

    let newSegmentsThisIteration = 0;
    const newSegmentsByItag = new Map<number, typeof segments>();
    for (const segment of segments) {
      if (segment.itag !== videoItag && segment.itag !== audioItag) {
        continue;
      }

      const existing = collectedByItag.get(segment.itag) ?? new Map<number, Uint8Array>();
      if (!existing.has(segment.sequenceNumber)) {
        existing.set(segment.sequenceNumber, segment.bytes);
        collectedByItag.set(segment.itag, existing);
        newSegmentsThisIteration++;

        const batch = newSegmentsByItag.get(segment.itag) ?? [];
        batch.push(segment);
        newSegmentsByItag.set(segment.itag, batch);
      }
    }

    for (const [itag, batch] of newSegmentsByItag) {
      batch.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
      const totalDuration = batch.reduce((sum, s) => sum + s.durationMs, 0);
      bufferedBatches.push({
        itag,
        startMs: batch[0].startMs,
        durationMs: totalDuration,
        startSegmentIndex: batch[0].sequenceNumber,
        endSegmentIndex: batch[batch.length - 1].sequenceNumber
      });
    }

    function bytesTotal(itag: number) {
      const m = collectedByItag.get(itag);
      if (!m) {
        return 0;
      }

      let total = 0;
      for (const bytes of m.values()) {
        total += bytes.byteLength;
      }
      return total;
    }

    const videoTotal = bytesTotal(videoItag);
    const audioTotal = bytesTotal(audioItag);

    const segsByItag: Record<number, number> = {};
    for (const s of segments) {
      segsByItag[s.itag] = (segsByItag[s.itag] ?? 0) + 1;
    }

    function latestEndMsFor(itag: number) {
      let maxEnd = 0;
      for (const batch of bufferedBatches) {
        if (batch.itag === itag) {
          const end = batch.startMs + batch.durationMs;
          if (end > maxEnd) maxEnd = end;
        }
      }
      return maxEnd;
    }

    function latestSegmentFor(itag: number) {
      let maxSeg = 0;
      for (const batch of bufferedBatches) {
        if (batch.itag === itag && batch.endSegmentIndex > maxSeg) {
          maxSeg = batch.endSegmentIndex;
        }
      }
      return maxSeg;
    }

    const vEndMs = latestEndMsFor(videoItag);
    const aEndMs = latestEndMsFor(audioItag);
    await writeOwnSabrTrace({
      phase: "iter",
      iter,
      resp: response.byteLength,
      segs: segments.length,
      segsByItag,
      new: newSegmentsThisIteration,
      vBytes: videoTotal,
      aBytes: audioTotal,
      vExpected: videoExpected,
      aExpected: audioExpected,
      vEndMs,
      aEndMs,
      vLastSeg: latestSegmentFor(videoItag),
      aLastSeg: latestSegmentFor(audioItag),
      cookie: !!playbackCookie,
      backoffMs: backoffTimeMs,
      bodyLen: body.byteLength,
      batches: bufferedBatches.length
    }, tabId);

    const videoDone = videoExpected > 0 && videoTotal >= videoExpected;
    const audioDone = audioExpected > 0 && audioTotal >= audioExpected;
    if (videoDone && audioDone) {
      break;
    }

    if (newSegmentsThisIteration === 0) {
      noProgressIterations++;
      if (noProgressIterations >= NO_PROGRESS_LIMIT) {
        break;
      }
    } else {
      noProgressIterations = 0;
    }

    if (playbackCookie) {
      const spliced = spliceBodyWithPlaybackCookie(body, playbackCookie);
      body = new Uint8Array(spliced);
    }

    const PLAYER_LOOKAHEAD_MS = 5000;
    const minEndMs = Math.min(vEndMs, aEndMs);
    const playerTimeMs = minEndMs + PLAYER_LOOKAHEAD_MS;

    const splicedState = spliceBodyWithState({
      body,
      playerTimeMs,
      ranges: bufferedBatches
    });
    body = new Uint8Array(splicedState);

    if (backoffTimeMs > 0) {
      await new Promise(resolve => setTimeout(resolve, backoffTimeMs));
    }
  }

  function concatSequencedMap(itag: number) {
    const m = collectedByItag.get(itag);
    if (!m || m.size === 0) {
      return null;
    }

    const sorted = [...m.entries()].sort((a, b) => a[0] - b[0]);
    const total = sorted.reduce((sum, [, bytes]) => sum + bytes.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const [, bytes] of sorted) {
      out.set(bytes, offset);
      offset += bytes.byteLength;
    }
    return out;
  }

  return {
    videoData: concatSequencedMap(videoItag),
    audioData: concatSequencedMap(audioItag),
    additionalAudioTracks: []
  };
}

async function attemptSabrDownload({ request, signal, tabId, firstBodyOverride }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  firstBodyOverride?: Uint8Array;
}) {
  const sabrAbortController = new AbortController();
  let sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
  signal.addEventListener("abort", () => sabrAbortController.abort(), { once: true });

  function resetSabrStallTimer() {
    clearTimeout(sabrStallTimeoutId);
    sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
  }

  try {
    return await downloadViaSabr({
      request,
      signal: sabrAbortController.signal,
      tabId,
      firstBodyOverride,
      onProgress: resetSabrStallTimer
    });
  } finally {
    clearTimeout(sabrStallTimeoutId);
  }
}

export async function startBackgroundDownload({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  const { videoId, metadata } = request;
  cancelBackgroundDownload(videoId);
  const abortController = new AbortController();
  activeBackgroundDownloads.set(videoId, abortController);
  const { signal } = abortController;

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);

    // On Firefox, the library's constructed SABR body is missing fields YT
    // requires (observed: clientAbrState is 13 bytes vs YT player's 97).
    // Seed the first fetch with the captured body so we pass the initial
    // handshake; library takes over from UMP response onwards. Also swap
    // the request's video/audio format IDs to match whatever YT player is
    // actively requesting — otherwise the library's subsequent self-built
    // requests ask for a format the server never decided to prime a
    // response for, and no MEDIA parts are extracted.
    // On Firefox, skip SabrStream entirely and use our own UMP parser.
    // The library's state machine fails to extract media when we seed it
    // with YT player's captured body (server doesn't re-send
    // FORMAT_INITIALIZATION_METADATA for a mid-session request).
    if (import.meta.env.FIREFOX) {
      const firefoxResult = await runFirefoxOwnSabr({ request, tabId, signal }).catch(() => null);
      if (firefoxResult && (firefoxResult.videoData || firefoxResult.audioData)) {
        const enrichedMetadata = await enrichedMetadataPromise;
        await dispatchToOffscreen({
          request,
          result: firefoxResult,
          enrichedMetadata,
          tabId
        });
        void clearInterruptedDownload(videoId);
        return;
      }
    }

    let firstBodyOverride: Uint8Array | undefined = undefined;
    let sabrRequest = request;
    if (import.meta.env.FIREFOX) {
      const { getCapturedSabrData, extractPreferredFormatItagsFromBody } = await import("@/lib/youtube/sabr-request-capture");
      const captured = getCapturedSabrData(tabId);
      if (captured) {
        firstBodyOverride = new Uint8Array(captured.body);
        const itags = extractPreferredFormatItagsFromBody(captured.body);
        const ytVideoFormat = itags.video[0] !== undefined
          ? request.sabrConfig?.formats.find(f => f.itag === itags.video[0])
          : undefined;
        const ytAudioFormat = itags.audio[0] !== undefined
          ? request.sabrConfig?.formats.find(f => f.itag === itags.audio[0])
          : undefined;
        sabrRequest = {
          ...request,
          videoFormat: ytVideoFormat ?? request.videoFormat,
          audioFormat: ytAudioFormat ?? request.audioFormat
        };
      }
    }
    let result = await attemptSabrDownload({
      request: sabrRequest,
      signal,
      tabId,
      firstBodyOverride
    }).catch(sabrError => {
      if (signal.aborted) {
        throw sabrError;
      }

      console.warn("[ytdl:bg] SABR failed, trying CDN:", sabrError);
      // Resets the UI to indeterminate rather than a frozen percentage while CDN starts.
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress: 0,
        progressType: ProgressType.Video
      }, tabId);
      return null;
    });
    if (!result?.audioData) {
      result = await downloadViaCdn({
        request,
        signal,
        videoId,
        tabId
      });
    }

    if (!result?.audioData && !result?.videoData) {
      console.warn("[ytdl:bg] No download method succeeded for", videoId);
      reportDownloadFailed({
        videoId,
        tabId
      });
      return;
    }

    const enrichedMetadata = await enrichedMetadataPromise;
    await dispatchToOffscreen({
      request,
      result,
      enrichedMetadata,
      tabId
    });
    void clearInterruptedDownload(videoId);
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    if (!navigator.onLine) {
      queueNetworkRetry({
        request,
        tabId
      });
      return;
    }

    console.warn("[ytdl:bg] Background download failed:", error);
    reportDownloadFailed({
      videoId,
      tabId
    });
  } finally {
    activeBackgroundDownloads.delete(videoId);
  }
}
