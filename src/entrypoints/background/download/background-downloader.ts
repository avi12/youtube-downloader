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

// Firefox-only: drive SABR ourselves (no SabrStream). Starts from YT
// player's captured body (which passes attestation), then on each iteration:
//   1. POST with incrementing &rn=N query param.
//   2. Parse UMP response; collect MEDIA parts keyed by format+sequence.
//   3. Splice the server's NEXT_REQUEST_POLICY.playbackCookie into the
//      outgoing body's streamerContext so the server advances us.
//
// Known gap for full convergence (not yet implemented): ALSO advance
// clientAbrState.playerTimeMs and populate bufferedRanges from parsed
// MEDIA_HEADER timestamps (per yt-dlp's SABR reference implementation,
// PR #13515). Without those, a server that ignores playbackCookie alone
// will keep re-serving the same initial-segment window until the loop's
// NO_PROGRESS_LIMIT trips.
async function runFirefoxOwnSabr({ request, tabId, signal }: {
  request: DownloadRequest;
  tabId: number;
  signal: AbortSignal;
}): Promise<DownloadResult | null> {
  const { getCapturedSabrData, extractPreferredFormatItagsFromBody } = await import("@/lib/youtube/sabr-request-capture");
  const { firefoxSabrSingleFetch, assembleMediaByFormat, spliceBodyWithPlaybackCookie } = await import("@/lib/youtube/firefox-sabr");

  const captured = getCapturedSabrData(tabId);
  if (!captured) {
    return null;
  }

  const itags = extractPreferredFormatItagsFromBody(captured.body);
  const videoItag = itags.video[0];
  const audioItag = itags.audio[0];
  if (videoItag === undefined || audioItag === undefined) {
    return null;
  }

  let body = new Uint8Array(captured.body);
  const collectedVideo: Uint8Array[] = [];
  const collectedAudio: Uint8Array[] = [];
  const videoExpected = parseInt(
    request.sabrConfig?.formats.find(f => f.itag === videoItag)?.contentLength ?? "0", 10);
  const audioExpected = parseInt(
    request.sabrConfig?.formats.find(f => f.itag === audioItag)?.contentLength ?? "0", 10);

  const MAX_ITERATIONS = 400;
  const NO_PROGRESS_LIMIT = 3;
  const baseUrl = new URL(captured.url);
  let noProgressIterations = 0;
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (signal.aborted) {
      return null;
    }

    baseUrl.searchParams.set("rn", String(iter + 1));
    const { response } = await firefoxSabrSingleFetch({
      url: baseUrl.href,
      body,
      signal
    });
    const { videoBytes, audioBytes, playbackCookie } = assembleMediaByFormat({
      umpBody: response,
      expectedVideoItag: videoItag,
      expectedAudioItag: audioItag
    });

    const gotVideo = videoBytes.byteLength > 0;
    const gotAudio = audioBytes.byteLength > 0;
    if (gotVideo) {
      collectedVideo.push(videoBytes);
    }

    if (gotAudio) {
      collectedAudio.push(audioBytes);
    }

    const videoTotal = collectedVideo.reduce((sum, b) => sum + b.byteLength, 0);
    const audioTotal = collectedAudio.reduce((sum, b) => sum + b.byteLength, 0);

    const videoDone = videoExpected > 0 && videoTotal >= videoExpected;
    const audioDone = audioExpected > 0 && audioTotal >= audioExpected;
    if (videoDone && audioDone) {
      break;
    }

    if (!gotVideo && !gotAudio) {
      noProgressIterations++;
      if (noProgressIterations >= NO_PROGRESS_LIMIT) {
        break;
      }
    } else {
      noProgressIterations = 0;
    }

    if (!playbackCookie) {
      // Without a fresh playbackCookie, server will return the same segments.
      // Still try once more in case transient; after NO_PROGRESS_LIMIT we bail.
      continue;
    }

    const spliced = spliceBodyWithPlaybackCookie(body, playbackCookie);
    body = new Uint8Array(spliced);
  }

  function flatten(chunks: Uint8Array[]) {
    const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }

  const videoData = collectedVideo.length > 0 ? flatten(collectedVideo) : null;
  const audioData = collectedAudio.length > 0 ? flatten(collectedAudio) : null;

  return {
    videoData,
    audioData,
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
