import { createPageProxyFetch } from "./page-proxy-fetch";
import { sendProgressUpdate } from "./progress-fetch";
import { computeWeightedProgress } from "./progress-stages";
import { sendNetworkChunkToOffscreen, sendStreamFinishedMarker } from "./stream-chunk-transfer";
import { buildSubtitleTracks } from "./subtitle-track-builder";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { stripMimeParams } from "@/lib/utils/containers";
import { resolveAndroidUrls, type ResolvedAndroidUrls } from "@/lib/youtube/android-player";
import { DownloadType, ProgressType, StreamType } from "@/types";
import type { DownloadRequest, VideoMetadata } from "@/types";

const HTTP_STATUS_OK = 200;
const HTTP_STATUS_PARTIAL_CONTENT = 206;
const ANDROID_VR_CHUNK_SIZE = 10 * 1024 * 1024;
const FALLBACK_VIDEO_MIME_TYPE = "video/mp4";
const FALLBACK_AUDIO_MIME_TYPE = "audio/mp4";

type ChunkFetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type ChunkRangeFetchParams = {
  url: string;
  byteOffset: number;
  rangeEnd: number;
  bgFetch: ChunkFetchFn;
  pageProxyFetch: ChunkFetchFn | null;
  isUsingBgDirect: boolean;
  label: string;
};

async function fetchAndroidVrRange({
  url, byteOffset, rangeEnd, bgFetch, pageProxyFetch, isUsingBgDirect, label
}: ChunkRangeFetchParams): Promise<{
  response: Response;
  usedBgDirect: boolean;
}> {
  const init: RequestInit = {
    credentials: "include",
    headers: {
      Range: `bytes=${byteOffset}-${rangeEnd}`
    }
  };

  try {
    const performFetch = isUsingBgDirect ? bgFetch : pageProxyFetch!;
    const response = await performFetch(url, init);
    const isSuccessStatus = response.status === HTTP_STATUS_PARTIAL_CONTENT || response.status === HTTP_STATUS_OK;
    if (!isSuccessStatus) {
      throw new Error(`HTTP ${response.status}`);
    }

    return {
      response,
      usedBgDirect: isUsingBgDirect
    };
  } catch (error) {
    const canFallback = isUsingBgDirect && pageProxyFetch;
    if (!canFallback) {
      throw new Error(`${label} chunk fetch failed at offset ${byteOffset}: ${String(error)}`, { cause: error });
    }

    const response = await pageProxyFetch!(url, init);
    const isProxySuccessStatus = response.status === HTTP_STATUS_PARTIAL_CONTENT
      || response.status === HTTP_STATUS_OK;
    if (!isProxySuccessStatus) {
      throw new Error(`${label} chunk fetch HTTP ${response.status} at offset ${byteOffset} (page-proxy fallback)`, {
        cause: error
      });
    }

    return {
      response,
      usedBgDirect: false
    };
  }
}

type FetchAndroidVrChunkedParams = {
  url: string;
  contentLength: number;
  bgFetch: ChunkFetchFn;
  pageProxyFetch: ChunkFetchFn | null;
  onChunk: (chunk: Uint8Array, iChunk: number) => void;
  label: string;
};

// Closed-range chunked GETs (yt-dlp's --http-chunk-size default of 10 MB)
// against ANDROID_VR adaptive CDN URLs. The URLs are self-authenticated by
// signature, so `credentials: "include"` is safe and consistent with the
// rest of the InnerTube auth strategy.
async function fetchAndroidVrChunked(
  { url, contentLength, bgFetch, pageProxyFetch, onChunk, label }: FetchAndroidVrChunkedParams
) {
  let byteOffset = 0;
  let iChunk = 0;
  let isUsingBgDirect = true;
  while (byteOffset < contentLength) {
    const rangeEnd = Math.min(byteOffset + ANDROID_VR_CHUNK_SIZE - 1, contentLength - 1);
    const { response, usedBgDirect } = await fetchAndroidVrRange({
      url,
      byteOffset,
      rangeEnd,
      bgFetch,
      pageProxyFetch,
      isUsingBgDirect,
      label
    });
    isUsingBgDirect = usedBgDirect;

    const chunk = new Uint8Array(await response.arrayBuffer());
    const isEmptyChunk = chunk.byteLength === 0;
    if (isEmptyChunk) {
      throw new Error(`${label} chunk fetch empty at offset ${byteOffset}`);
    }

    onChunk(chunk, iChunk);
    iChunk++;
    byteOffset += chunk.byteLength;
  }

  return iChunk;
}

type ResolveAndroidUrlsForRequestParams = {
  videoId: string;
  videoItag: number;
  audioItag: number;
  wantsVideo: boolean;
  wantsAudio: boolean;
  pageProxyFetch: ChunkFetchFn | null;
};

async function resolveAndroidUrlsForRequest({
  videoId, videoItag, audioItag, wantsVideo, wantsAudio, pageProxyFetch
}: ResolveAndroidUrlsForRequestParams): Promise<ResolvedAndroidUrls> {
  try {
    return await resolveAndroidUrls({
      videoId,
      videoItag: wantsVideo ? videoItag : undefined,
      audioItag: wantsAudio ? audioItag : undefined
    });
  } catch (error) {
    if (!pageProxyFetch) {
      throw error;
    }

    return await resolveAndroidUrls({
      videoId,
      videoItag: wantsVideo ? videoItag : undefined,
      audioItag: wantsAudio ? audioItag : undefined,
      customFetch: pageProxyFetch
    });
  }
}

type ProgressReporterParams = {
  videoId: string;
  tabId: number;
  captionCount: number;
  wantsVideo: boolean;
  wantsAudio: boolean;
  videoExpectedBytes: number;
  audioExpectedBytes: number;
};

function createProgressReporter({
  videoId, tabId, captionCount, wantsVideo, wantsAudio, videoExpectedBytes, audioExpectedBytes
}: ProgressReporterParams) {
  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;

  function emit() {
    const progress = computeWeightedProgress({
      hasVideoStage: wantsVideo,
      videoReceivedBytes,
      videoExpectedBytes,
      hasAudioStage: wantsAudio,
      audioReceivedBytes,
      audioExpectedBytes,
      extraReceivedBytesArray: [],
      extraExpectedBytesArray: [],
      captionCount
    });
    void sendProgressUpdate({
      videoId,
      progress,
      progressType: ProgressType.Video,
      tabId
    });
  }

  return {
    onVideoBytes(bytes: number) {
      videoReceivedBytes += bytes;
      emit();
    },
    onAudioBytes(bytes: number) {
      audioReceivedBytes += bytes;
      emit();
    },
    emit
  };
}

type DispatchStreamEndParams = {
  request: DownloadRequest;
  enrichedMetadata: VideoMetadata | null;
  tabId: number;
};

function dispatchStreamEndToOffscreen({ request, enrichedMetadata, tabId }: DispatchStreamEndParams) {
  const { videoId, type, filenameOutput } = request;
  const videoFormat = request.videoFormat ?? null;
  const audioFormat = request.audioFormat ?? null;
  const videoMimeType = videoFormat ? stripMimeParams(videoFormat.mimeType) : FALLBACK_VIDEO_MIME_TYPE;
  const audioMimeType = audioFormat ? stripMimeParams(audioFormat.mimeType) : FALLBACK_AUDIO_MIME_TYPE;
  const subtitleTracks = buildSubtitleTracks({
    captionTracks: request.captionTracks,
    captionVttData: request.captionVttData ?? []
  });

  sendToOffscreen({
    type: OffscreenMessageType.ProcessStreamEnd,
    data: {
      type,
      videoId,
      filenameOutput,
      videoMimeType,
      audioMimeType,
      audioTrackLabels: [request.primaryAudioLabel ?? ""],
      audioTrackLanguages: [request.primaryAudioLanguageCode ?? ""],
      defaultAudioTrackIndex: 0,
      subtitleTracks,
      tabId,
      playlistId: request.playlistId,
      playlistTitle: request.playlistTitle,
      playlistTotalCount: request.playlistTotalCount,
      metadata: enrichedMetadata
    }
  });
}

type RunFirefoxDirectDownloadParams = {
  request: DownloadRequest;
  tabId: number;
  enrichedMetadata: VideoMetadata | null;
};

// Firefox-only download path. Chrome uses the offscreen-iframe SABR pipeline
// in `download-worker/main.ts`; Firefox can't because YouTube's anti-bot gate
// 403s SABR requests originating from Firefox's TLS fingerprint on Windows
// (regardless of cookies, PO token, or DNR header rewrites).
//
// The bypass mirrors yt-dlp's `android_vr` extractor: hit InnerTube with the
// ANDROID_VR (Oculus Quest YouTube VR app) client, which returns direct CDN
// URLs for every adaptive format with no SABR forcing and no per-request range
// cap. Bytes are then pulled in 10 MB closed-range chunks and streamed to the
// offscreen iframe for FFmpeg muxing on the shared Chrome+Firefox pipeline.
export async function runFirefoxDirectDownload(
  { request, tabId, enrichedMetadata }: RunFirefoxDirectDownloadParams
) {
  const { videoId, type, videoItag, audioItag } = request;
  // Page-proxy routes the InnerTube POST through the watch tab's MAIN-world
  // pristine fetch so cookies + page TLS context pass the anti-bot gate. The
  // BG-direct fetch is tried first as a fast path; if YouTube ever stops
  // 403-ing BG-context InnerTube on Firefox, the page-proxy hop is skipped.
  const isValidTabId = tabId >= 0;
  const pageProxyFetch = isValidTabId ? createPageProxyFetch(tabId) : null;
  const wantsVideo = type !== DownloadType.Audio;
  const wantsAudio = type !== DownloadType.Video;

  const resolved = await resolveAndroidUrlsForRequest({
    videoId,
    videoItag,
    audioItag,
    wantsVideo,
    wantsAudio,
    pageProxyFetch
  });
  if (wantsVideo && !resolved.videoUrl) {
    throw new Error(`ANDROID_VR did not return URL for video itag ${videoItag}`);
  }

  if (wantsAudio && !resolved.audioUrl) {
    throw new Error(`ANDROID_VR did not return URL for audio itag ${audioItag}`);
  }

  const progress = createProgressReporter({
    videoId,
    tabId,
    captionCount: request.captionTracks?.length ?? 0,
    wantsVideo,
    wantsAudio,
    videoExpectedBytes: resolved.videoContentLength,
    audioExpectedBytes: resolved.audioContentLength
  });

  function bgFetch(input: RequestInfo | URL, init?: RequestInit) {
    return fetch(input, init);
  }

  let videoChunkCount = 0;
  let audioChunkCount = 0;
  const shouldFetchVideo = wantsVideo && resolved.videoUrl;
  const shouldFetchAudio = wantsAudio && resolved.audioUrl;
  await Promise.all([
    shouldFetchVideo ? fetchAndroidVrChunked({
      url: resolved.videoUrl!,
      contentLength: resolved.videoContentLength,
      bgFetch,
      pageProxyFetch,
      label: "video",
      onChunk(chunk, iChunk) {
        sendNetworkChunkToOffscreen({
          videoId,
          streamType: StreamType.Video,
          iChunk,
          chunk,
          tabId
        });
        progress.onVideoBytes(chunk.byteLength);
        videoChunkCount = iChunk + 1;
      }
    }) : Promise.resolve(),
    shouldFetchAudio ? fetchAndroidVrChunked({
      url: resolved.audioUrl!,
      contentLength: resolved.audioContentLength,
      bgFetch,
      pageProxyFetch,
      label: "audio",
      onChunk(chunk, iChunk) {
        sendNetworkChunkToOffscreen({
          videoId,
          streamType: StreamType.Audio,
          iChunk,
          chunk,
          tabId
        });
        progress.onAudioBytes(chunk.byteLength);
        audioChunkCount = iChunk + 1;
      }
    }) : Promise.resolve()
  ]);

  progress.emit();

  if (wantsVideo) {
    sendStreamFinishedMarker({
      videoId,
      streamType: StreamType.Video,
      totalChunks: videoChunkCount,
      tabId
    });
  }

  if (wantsAudio) {
    sendStreamFinishedMarker({
      videoId,
      streamType: StreamType.Audio,
      totalChunks: audioChunkCount,
      tabId
    });
  }

  dispatchStreamEndToOffscreen({
    request,
    enrichedMetadata,
    tabId
  });
}
