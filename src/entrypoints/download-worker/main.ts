import { downloadViaCdn } from "../background/download/cdn-downloader";
import { downloadViaSabr } from "../background/download/sabr-downloader";
import { createSabrStallTimer } from "../background/download/sabr-stall-timer";
import { buildSubtitleTracks } from "../background/download/subtitle-track-builder";
import type { ProcessStreamEndData } from "@/lib/messaging/offscreen-messaging";
import { resolveQualityLabel } from "@/lib/youtube/audio-format-helpers";
import { DownloadType, StreamType } from "@/types";
import type { DownloadRequest, Prettify, VideoMetadata } from "@/types";

const WORKER_MESSAGE_CHUNK = "worker-chunk";
const WORKER_MESSAGE_STREAM_END = "worker-stream-end";
const WORKER_MESSAGE_COMPLETE = "worker-complete";
const WORKER_MESSAGE_NEEDS_DIRECT_URL = "worker-needs-direct-url";
const WORKER_MESSAGE_NEEDS_FALLBACK = "worker-needs-fallback";
const WORKER_MESSAGE_ERROR = "worker-error";
const IFRAME_MESSAGE_START = "start";
const IFRAME_MESSAGE_CANCEL = "cancel";
const DEFAULT_VIDEO_MIME_TYPE = "video/mp4";
const DEFAULT_AUDIO_MIME_TYPE = "audio/mp4";

const abortController = new AbortController();
const { signal } = abortController;

addEventListener("message", e => {
  const isExternalOrigin = e.origin !== location.origin;
  if (isExternalOrigin) {
    return;
  }

  const isCancel = e.data?.type === IFRAME_MESSAGE_CANCEL;
  if (isCancel) {
    abortController.abort();
  }

  const isStart = e.data?.type === IFRAME_MESSAGE_START;
  if (isStart) {
    const { request, tabId, enrichedMetadata } = e.data;
    runDownload({
      request,
      tabId,
      enrichedMetadata
    }).catch(() => {});
  }
}, { once: false });

type TrySabrWithStallTimerParams = Prettify<{
  request: DownloadRequest;
  tabId: number;
}>;
async function trySabrWithStallTimer({ request, tabId }: TrySabrWithStallTimerParams) {
  const stallTimer = createSabrStallTimer(signal);

  const isAudioOnly = request.type === DownloadType.Audio;
  const useStreaming = !isAudioOnly;

  try {
    return await downloadViaSabr({
      request,
      signal: stallTimer.signal,
      tabId,
      onProgress: stallTimer.onProgress,
      ...(useStreaming && {
        onVideoChunk: sendChunkToParent({
          videoId: request.videoId,
          streamType: StreamType.Video,
          tabId
        }),
        onAudioChunk: sendChunkToParent({
          videoId: request.videoId,
          streamType: StreamType.Audio,
          tabId
        }),
        onVideoStreamEnd: sendStreamEndToParent({
          videoId: request.videoId,
          streamType: StreamType.Video
        }),
        onAudioStreamEnd: sendStreamEndToParent({
          videoId: request.videoId,
          streamType: StreamType.Audio
        })
      })
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    console.warn("[ytdl:worker] SABR failed, trying CDN:", error);
    return null;
  } finally {
    stallTimer.cleanup();
  }
}

type SendChunkToParentParams = Prettify<{
  videoId: string;
  streamType: string;
  tabId: number;
}>;
function sendChunkToParent({ videoId, streamType, tabId }: SendChunkToParentParams) {
  return (chunk: Uint8Array, iChunk: number) => {
    const buffer = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(buffer).set(chunk);
    parent.postMessage(
      {
        type: WORKER_MESSAGE_CHUNK,
        videoId,
        streamType,
        iChunk,
        tabId,
        buffer
      },
      location.origin,
      [buffer]
    );
  };
}

type SendStreamEndToParentParams = Prettify<{
  videoId: string;
  streamType: string;
}>;
function sendStreamEndToParent({ videoId, streamType }: SendStreamEndToParentParams) {
  return (totalChunks: number) => {
    parent.postMessage(
      {
        type: WORKER_MESSAGE_STREAM_END,
        videoId,
        streamType,
        totalChunks
      },
      location.origin
    );
  };
}

type BuildStreamEndParams = Prettify<{
  request: DownloadRequest;
  tabId: number;
  enrichedMetadata: VideoMetadata | null;
  additionalAudioTrackLabels: string[];
  additionalAudioLanguageCodes: string[];
}>;
function buildStreamEnd({
  request, tabId, enrichedMetadata, additionalAudioTrackLabels, additionalAudioLanguageCodes
}: BuildStreamEndParams): ProcessStreamEndData {
  const {
    videoId, type, filenameOutput, videoFormat, audioFormat,
    primaryAudioLabel, primaryAudioLanguageCode,
    captionTracks, captionVttData,
    playlistId, playlistTitle, playlistTotalCount, sourceUrl
  } = request;
  const videoMimeType = videoFormat?.mimeType ?? DEFAULT_VIDEO_MIME_TYPE;
  const audioMimeType = audioFormat?.mimeType ?? DEFAULT_AUDIO_MIME_TYPE;
  const subtitleTracks = buildSubtitleTracks({
    captionTracks,
    captionVttData: captionVttData ?? []
  });

  return {
    type,
    videoId,
    filenameOutput,
    videoMimeType,
    audioMimeType,
    audioTrackLabels: [primaryAudioLabel ?? "", ...additionalAudioTrackLabels],
    audioTrackLanguages: [primaryAudioLanguageCode ?? "", ...additionalAudioLanguageCodes],
    defaultAudioTrackIndex: 0,
    subtitleTracks,
    tabId,
    playlistId,
    playlistTitle,
    playlistTotalCount,
    metadata: enrichedMetadata,
    quality: resolveQualityLabel({
      type,
      videoFormat,
      audioFormat
    }),
    sourceUrl
  };
}

type RunDownloadParams = Prettify<{
  request: DownloadRequest;
  tabId: number;
  enrichedMetadata: VideoMetadata | null;
}>;
async function runDownload({ request, tabId, enrichedMetadata }: RunDownloadParams) {
  const { videoId, type, resolvedVideoUrl, resolvedAudioUrl } = request;

  try {
    const sabrResult = await trySabrWithStallTimer({
      request,
      tabId
    });
    if (signal.aborted) {
      return;
    }

    const isAudioDataMissing = !(sabrResult?.audioData?.byteLength) && !sabrResult?.streamedToOffscreen;
    const needsCdn = isAudioDataMissing || sabrResult?.isPartialVideo || sabrResult?.isPartialAudio;
    const isCdnUrlsPresent = !!(resolvedVideoUrl || resolvedAudioUrl);
    const isAudioOnly = type === DownloadType.Audio;

    let cdnResult = null;
    const shouldUseCdn = needsCdn && isCdnUrlsPresent;
    if (shouldUseCdn) {
      const partialAudioData = sabrResult?.isPartialAudio ? (sabrResult.audioData ?? undefined) : undefined;
      const useStreaming = !isAudioOnly && !partialAudioData;

      cdnResult = await downloadViaCdn({
        request,
        signal,
        videoId,
        tabId,
        partialAudioData,
        ...(useStreaming && {
          onVideoChunk: sendChunkToParent({
            videoId,
            streamType: StreamType.Video,
            tabId
          }),
          onAudioChunk: sendChunkToParent({
            videoId,
            streamType: StreamType.Audio,
            tabId
          }),
          onVideoStreamEnd: sendStreamEndToParent({
            videoId,
            streamType: StreamType.Video
          }),
          onAudioStreamEnd: sendStreamEndToParent({
            videoId,
            streamType: StreamType.Audio
          })
        })
      }).catch(error => {
        if (signal.aborted) {
          throw error;
        }

        console.warn("[ytdl:worker] CDN failed:", error);
        return null;
      });
    }

    if (signal.aborted) {
      return;
    }

    const result = cdnResult ?? sabrResult;
    const hasNoVideoData = !(result?.videoData?.byteLength);
    const hasNoAudioData = !(result?.audioData?.byteLength);
    const isNotStreamed = !result?.streamedToOffscreen;
    const isDataMissing = !result || (hasNoVideoData && hasNoAudioData && isNotStreamed);
    if (isDataMissing) {
      const isDirectUrlEligible = isAudioOnly && !!resolvedAudioUrl;
      if (isDirectUrlEligible) {
        parent.postMessage(
          {
            type: WORKER_MESSAGE_NEEDS_DIRECT_URL,
            videoId,
            tabId,
            request
          },
          location.origin
        );
        return;
      }

      parent.postMessage(
        {
          type: WORKER_MESSAGE_NEEDS_FALLBACK,
          videoId,
          tabId,
          request
        },
        location.origin
      );
      return;
    }

    const additionalAudioTracks = result.additionalAudioTracks ?? [];
    const streamEnd = buildStreamEnd({
      request,
      tabId,
      enrichedMetadata,
      additionalAudioTrackLabels: additionalAudioTracks.map(track => track.label),
      additionalAudioLanguageCodes: additionalAudioTracks.map(track => track.languageCode)
    });

    const isStreamed = result.streamedToOffscreen === true;

    function toArrayBuffer(data: Uint8Array): ArrayBuffer {
      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      return buffer;
    }

    const extraAudioBuffers: ArrayBuffer[] = additionalAudioTracks
      .map(track => track.data)
      .filter((data): data is Uint8Array => data !== null && data.byteLength > 0)
      .map(data => toArrayBuffer(data));

    const transferList: ArrayBuffer[] = [...extraAudioBuffers];
    const completeMsg: Record<string, unknown> = {
      type: WORKER_MESSAGE_COMPLETE,
      videoId,
      isStreamed,
      streamEnd,
      extraAudioBuffers
    };
    if (!isStreamed) {
      const hasVideoData = !!result.videoData?.byteLength;
      if (hasVideoData) {
        const videoBuffer = toArrayBuffer(result.videoData!);
        transferList.push(videoBuffer);
        completeMsg.videoBuffer = videoBuffer;
      }

      const hasAudioData = !!result.audioData?.byteLength;
      if (hasAudioData) {
        const audioBuffer = toArrayBuffer(result.audioData!);
        transferList.push(audioBuffer);
        completeMsg.audioBuffer = audioBuffer;
      }
    }

    parent.postMessage(completeMsg, location.origin, transferList);
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    console.error("[ytdl:worker] Download failed:", error);
    parent.postMessage(
      {
        type: WORKER_MESSAGE_ERROR,
        videoId,
        tabId,
        error: String(error)
      },
      location.origin
    );
  }
}
