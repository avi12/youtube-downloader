import { FrameCommandKind, isFrameCommand, WorkerMessageKind } from "@/layers/processing/worker-frame-messages";
import { createLogger, LogScope } from "@/lib/utils/logger";
import { resolveQualityLabel } from "@/lib/youtube/audio-format-helpers";
import { DownloadType, StreamType } from "@/types";
import type { DownloadRequest, Prettify, VideoMetadata } from "@/types";
import { downloadViaCdn } from "#background/download/cdn-downloader";
import { downloadViaSabr } from "#background/download/sabr-downloader";
import { createSabrStallTimer } from "#background/download/sabr-stall-timer";
import { buildSubtitleTracks } from "#background/download/subtitle-track-builder";

const log = createLogger(LogScope.Worker);

const DEFAULT_VIDEO_MIME_TYPE = "video/mp4";
const DEFAULT_AUDIO_MIME_TYPE = "audio/mp4";

const abortController = new AbortController();
const { signal } = abortController;

addEventListener("message", event => {
  const isExternalOrigin = event.origin !== location.origin;
  if (isExternalOrigin) {
    return;
  }

  const command: unknown = event.data;
  if (!isFrameCommand(command)) {
    return;
  }

  if (command.type === FrameCommandKind.Cancel) {
    abortController.abort();
    return;
  }

  runDownload(command).catch(() => {});
}, { once: false });

type TrySabrWithStallTimerParams = Prettify<{
  request: DownloadRequest;
  tabId: number;
}>;
async function trySabrWithStallTimer({ request, tabId }: TrySabrWithStallTimerParams) {
  const stallTimer = createSabrStallTimer(signal);

  const isAudioOnly = request.type === DownloadType.Audio;
  const isStreaming = !isAudioOnly;

  try {
    return await downloadViaSabr({
      request,
      signal: stallTimer.signal,
      tabId,
      onProgress: stallTimer.onProgress,
      ...(isStreaming && {
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

    log.warn("SABR failed, trying CDN:", error);
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
        type: WorkerMessageKind.Chunk,
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
        type: WorkerMessageKind.StreamEnd,
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
}: BuildStreamEndParams) {
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

    const isSabrPartial = !!(sabrResult?.isPartialVideo || sabrResult?.isPartialAudio);
    const isSabrStreamPartial = !!sabrResult?.streamedToOffscreen && isSabrPartial;
    if (isSabrStreamPartial) {
      parent.postMessage({
        type: WorkerMessageKind.DiscardStreams,
        videoId
      }, location.origin);
    }

    const isAudioDataMissing = !(sabrResult?.audioData?.byteLength) && !sabrResult?.streamedToOffscreen;
    const needsCdn = isAudioDataMissing || sabrResult?.isPartialVideo || sabrResult?.isPartialAudio;
    const isCdnUrlsPresent = !!(resolvedVideoUrl || resolvedAudioUrl);
    const isAudioOnly = type === DownloadType.Audio;

    let cdnResult = null;
    const shouldUseCdn = needsCdn && isCdnUrlsPresent;
    if (shouldUseCdn) {
      const partialAudioData = sabrResult?.isPartialAudio ? (sabrResult.audioData ?? undefined) : undefined;
      const isStreaming = !isAudioOnly && !partialAudioData;

      cdnResult = await downloadViaCdn({
        request,
        signal,
        videoId,
        tabId,
        partialAudioData,
        ...(isStreaming && {
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

        log.warn("CDN failed:", error);
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
    const isPartialUnrecovered = !cdnResult && isSabrStreamPartial;
    const isDataMissing = !result || isPartialUnrecovered || (hasNoVideoData && hasNoAudioData && isNotStreamed);
    if (isDataMissing) {
      const isDirectUrlEligible = isAudioOnly && !!resolvedAudioUrl;
      if (isDirectUrlEligible) {
        parent.postMessage(
          {
            type: WorkerMessageKind.NeedsDirectUrl,
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
          type: WorkerMessageKind.NeedsFallback,
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

    function toArrayBuffer(data: Uint8Array | null | undefined) {
      if (!data?.byteLength) {
        return null;
      }

      const buffer = new ArrayBuffer(data.byteLength);
      new Uint8Array(buffer).set(data);
      return buffer;
    }

    const videoBuffer = isStreamed ? null : toArrayBuffer(result.videoData);
    const audioBuffers = [
      isStreamed ? null : toArrayBuffer(result.audioData),
      ...additionalAudioTracks.map(track => toArrayBuffer(track.data))
    ];
    const transferList = [videoBuffer, ...audioBuffers].filter(buffer => buffer !== null);
    parent.postMessage(
      {
        type: WorkerMessageKind.Complete,
        videoId,
        streamEnd,
        videoBuffer,
        audioBuffers
      },
      location.origin,
      transferList
    );
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    log.error("Download failed:", error);
    parent.postMessage(
      {
        type: WorkerMessageKind.Error,
        videoId,
        tabId,
        error: String(error)
      },
      location.origin
    );
  }
}
