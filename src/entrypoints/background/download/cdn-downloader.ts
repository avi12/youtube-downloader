import type { DownloadResult } from "./background-downloader";
import { fetchWithProgress } from "./cdn-fetch";
import { createCdnProgressTracker } from "./cdn-progress";
import { parseContentLength } from "./sabr-utils";
import { sendNetworkChunkToOffscreen, sendStreamFinishedMarker } from "./stream-chunk-transfer";
import { stripMimeParams } from "@/lib/utils/containers";
import { DownloadType, StreamType } from "@/types";
import type { DownloadRequest } from "@/types";

type FetchStreamParams = {
  url: string | null | undefined;
  signal: AbortSignal;
  onBytes: (n: number) => void;
  initialData?: Uint8Array;
  onChunk?: (chunk: Uint8Array) => void;
};
function fetchStream({ url, signal, onBytes, initialData, onChunk }: FetchStreamParams) {
  if (!url) {
    return Promise.resolve(null);
  }

  return fetchWithProgress({
    url,
    signal,
    onBytesReceived: onBytes,
    initialData,
    onChunk
  });
}

type DownloadViaCdnParams = {
  request: DownloadRequest;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  partialVideoData?: Uint8Array;
  partialAudioData?: Uint8Array;
  onVideoChunk?: (chunk: Uint8Array, iChunk: number) => void;
  onAudioChunk?: (chunk: Uint8Array, iChunk: number) => void;
  onVideoStreamEnd?: (totalChunks: number) => void;
  onAudioStreamEnd?: (totalChunks: number) => void;
};
export async function downloadViaCdn({
  request, signal, videoId, tabId, partialVideoData, partialAudioData,
  onVideoChunk, onAudioChunk, onVideoStreamEnd, onAudioStreamEnd
}: DownloadViaCdnParams) {
  const {
    type, videoFormat, audioFormat,
    resolvedVideoUrl, resolvedAudioUrl, resolvedExtraAudioUrls, additionalAudioFormats
  } = request;
  const hasNoUrls = !resolvedVideoUrl && !resolvedAudioUrl;
  if (hasNoUrls) {
    return null;
  }

  const captionCount = request.captionTracks?.length ?? 0;
  const extraUrls = resolvedExtraAudioUrls ?? [];
  const hasVideo = type !== DownloadType.Audio;
  const hasAudio = type !== DownloadType.Video;
  const totalStages = captionCount + (hasVideo ? 1 : 0) + (hasAudio ? 1 : 0) + extraUrls.length;

  const tracker = createCdnProgressTracker({
    videoId,
    tabId,
    totalStages,
    captionCount,
    hasVideo,
    hasAudio,
    extraCount: extraUrls.length,
    videoExpectedBytes: parseContentLength(videoFormat ?? null),
    audioExpectedBytes: parseContentLength(audioFormat ?? null),
    extraExpectedBytesArray: (additionalAudioFormats ?? []).map(format => parseContentLength(format)),
    initialVideoBytes: partialVideoData?.byteLength ?? 0,
    initialAudioBytes: partialAudioData?.byteLength ?? 0
  });

  const isStreamingMode = hasVideo && hasAudio && !partialVideoData && !partialAudioData;
  let iVideoChunk = 0;
  let iAudioChunk = 0;

  const cdnResults = await Promise.all([
    hasVideo ? fetchStream({
      url: resolvedVideoUrl,
      signal,
      onBytes: tracker.onVideoBytes,
      initialData: partialVideoData,
      onChunk: isStreamingMode ? chunk => {
        if (onVideoChunk) {
          onVideoChunk(chunk, iVideoChunk++);
        } else {
          sendNetworkChunkToOffscreen({
            videoId,
            streamType: StreamType.Video,
            iChunk: iVideoChunk++,
            chunk,
            tabId
          });
        }
      } : undefined
    }) : Promise.resolve(null),
    hasAudio ? fetchStream({
      url: resolvedAudioUrl,
      signal,
      onBytes: tracker.onAudioBytes,
      initialData: partialAudioData,
      onChunk: isStreamingMode ? chunk => {
        if (onAudioChunk) {
          onAudioChunk(chunk, iAudioChunk++);
        } else {
          sendNetworkChunkToOffscreen({
            videoId,
            streamType: StreamType.Audio,
            iChunk: iAudioChunk++,
            chunk,
            tabId
          });
        }
      } : undefined
    }) : Promise.resolve(null),
    ...extraUrls.map((url, i) => fetchStream({
      url,
      signal,
      onBytes: bytes => tracker.onExtraBytes({
        i,
        bytes
      })
    }))
  ]);

  const additionalAudioTracks: DownloadResult["additionalAudioTracks"] = [];
  const extraAudioBytes = cdnResults.slice(2);
  for (const [i, format] of (additionalAudioFormats ?? []).entries()) {
    additionalAudioTracks.push({
      data: extraAudioBytes[i] ?? null,
      mimeType: stripMimeParams(format.mimeType),
      label: format.audioTrack?.displayName ?? `Track ${i + 2}`,
      languageCode: format.audioTrack?.id?.split(".")[0] ?? "",
      isDefault: format.audioTrack?.audioIsDefault ?? false
    });
  }

  if (isStreamingMode) {
    if (onVideoStreamEnd) {
      onVideoStreamEnd(iVideoChunk);
      onAudioStreamEnd?.(iAudioChunk);
    } else {
      sendStreamFinishedMarker({
        videoId,
        streamType: StreamType.Video,
        totalChunks: iVideoChunk,
        tabId
      });
      sendStreamFinishedMarker({
        videoId,
        streamType: StreamType.Audio,
        totalChunks: iAudioChunk,
        tabId
      });
    }

    return {
      videoData: null,
      audioData: null,
      additionalAudioTracks,
      streamedToOffscreen: true
    };
  }

  const [videoData = null, audioData = null] = cdnResults;
  return {
    videoData,
    audioData,
    additionalAudioTracks
  };
}
