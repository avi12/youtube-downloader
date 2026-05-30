import {
  downloadAudioOnlyViaSabr,
  downloadVideoAudioViaSabr,
  downloadExtraAudioTracksViaSabr
} from "./sabr-fetch-helpers";
import { createProgressAccumulator } from "./sabr-progress";
import { buildEffectiveSabrConfig } from "./sabr-utils";
import { sendNetworkChunkToOffscreen, sendStreamFinishedMarker } from "./stream-chunk-transfer";
import { DownloadType, StreamType } from "@/types";
import type { DownloadRequest } from "@/types";

export { parseContentLength, buildEffectiveSabrConfig } from "./sabr-utils";

type DownloadViaSabrParams = {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
  onVideoChunk?: (chunk: Uint8Array, iChunk: number) => void;
  onAudioChunk?: (chunk: Uint8Array, iChunk: number) => void;
  onVideoStreamEnd?: (totalChunks: number) => void;
  onAudioStreamEnd?: (totalChunks: number) => void;
};
export async function downloadViaSabr({
  request, signal, tabId, onProgress, onVideoChunk, onAudioChunk, onVideoStreamEnd, onAudioStreamEnd
}: DownloadViaSabrParams) {
  const { videoId, type, sabrConfig, poToken, sabrUrl, videoFormat, audioFormat, additionalAudioFormats } = request;
  const isAudioOnly = type === DownloadType.Audio;

  const effectiveConfig = sabrConfig ? buildEffectiveSabrConfig({
    sabrConfig,
    sabrUrl
  }) : null;
  const isMissingRequiredConfig = !effectiveConfig || !audioFormat;
  if (isMissingRequiredConfig) {
    return null;
  }

  const isMissingVideoFormat = !isAudioOnly && !videoFormat;
  if (isMissingVideoFormat) {
    return null;
  }

  const captionCount = request.captionTracks?.length ?? 0;
  const additionalFormats = additionalAudioFormats ?? [];
  const resolvedPoToken = poToken ?? "";

  const { onVideoBytes, onAudioBytes, onExtraTrackBytes } = createProgressAccumulator({
    videoId,
    tabId,
    captionCount,
    isAudioOnly,
    videoFormat: videoFormat ?? null,
    audioFormat,
    additionalFormats,
    onProgress
  });
  if (isAudioOnly) {
    let iChunk = 0;
    const audioResult = await downloadAudioOnlyViaSabr({
      config: effectiveConfig,
      audioFormat,
      poToken: resolvedPoToken,
      signal,
      onBytesReceived: onAudioBytes,
      onChunk(chunk) {
        sendNetworkChunkToOffscreen({
          videoId,
          streamType: StreamType.Audio,
          iChunk: iChunk++,
          chunk,
          tabId
        });
      }
    });
    sendStreamFinishedMarker({
      videoId,
      streamType: StreamType.Audio,
      totalChunks: iChunk,
      tabId
    });
    return {
      videoData: null,
      audioData: null,
      additionalAudioTracks: [],
      isPartialAudio: !audioResult.isComplete,
      streamedToOffscreen: true
    };
  }

  if (!videoFormat) {
    return null;
  }

  const isStreamingMode = !!(onVideoChunk && onAudioChunk);
  let iVideoChunk = 0;
  let iAudioChunk = 0;
  const [videoResult, audioResult] = await downloadVideoAudioViaSabr({
    config: effectiveConfig,
    videoFormat,
    audioFormat,
    poToken: resolvedPoToken,
    signal,
    onVideoBytesReceived: onVideoBytes,
    onAudioBytesReceived: onAudioBytes,
    onVideoChunk: onVideoChunk ? chunk => onVideoChunk(chunk, iVideoChunk++) : undefined,
    onAudioChunk: onAudioChunk ? chunk => onAudioChunk(chunk, iAudioChunk++) : undefined
  });
  if (isStreamingMode) {
    onVideoStreamEnd?.(iVideoChunk);
    onAudioStreamEnd?.(iAudioChunk);
  }

  const additionalAudioTracks = await downloadExtraAudioTracksViaSabr({
    config: effectiveConfig,
    formats: additionalFormats,
    poToken: resolvedPoToken,
    signal,
    onTrackBytesReceived: onExtraTrackBytes
  });
  if (isStreamingMode) {
    return {
      videoData: null,
      audioData: null,
      additionalAudioTracks,
      isPartialVideo: !videoResult.isComplete,
      isPartialAudio: !audioResult.isComplete,
      streamedToOffscreen: true
    };
  }

  return {
    videoData: videoResult.data,
    audioData: audioResult.data,
    additionalAudioTracks,
    isPartialVideo: !videoResult.isComplete,
    isPartialAudio: !audioResult.isComplete
  };
}
