import {
  downloadAudioOnlyViaSabr,
  downloadVideoAudioViaSabr,
  downloadExtraAudioTracksViaSabr
} from "./sabr-fetch-helpers";
import { createProgressAccumulator } from "./sabr-progress";
import { buildEffectiveSabrConfig } from "./sabr-utils";
import { sendNetworkChunkToOffscreen, sendStreamFinishedMarker } from "./stream-chunk-transfer";
import { DownloadType, StreamType } from "@/types";
import type { DownloadRequest, Prettify } from "@/types";

export { parseContentLength, buildEffectiveSabrConfig } from "./sabr-utils";

type DownloadViaSabrParams = Prettify<{
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
  onVideoChunk?: (chunk: Uint8Array, iChunk: number) => void;
  onAudioChunk?: (chunk: Uint8Array, iChunk: number) => void;
  onVideoStreamEnd?: (totalChunks: number) => void;
  onAudioStreamEnd?: (totalChunks: number) => void;
}>;
export async function downloadViaSabr({
  request,
  signal,
  tabId,
  onProgress,
  onVideoChunk: callerOnVideoChunk,
  onAudioChunk: callerOnAudioChunk,
  onVideoStreamEnd,
  onAudioStreamEnd
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
      onChunk(chunk) {
        // Count parsed media bytes (after googlevideo strips UMP framing
        // and dedupes re-deliveries). Raw network bytes overcount by 10-100x
        // because of UMP envelopes + SABR session retries.
        onAudioBytes(chunk.byteLength);
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

  const isStreamingMode = !!(callerOnVideoChunk && callerOnAudioChunk);
  let iVideoChunk = 0;
  let iAudioChunk = 0;
  const [videoResult, audioResult] = await downloadVideoAudioViaSabr({
    config: effectiveConfig,
    videoFormat,
    audioFormat,
    poToken: resolvedPoToken,
    signal,
    onVideoChunk(chunk) {
      onVideoBytes(chunk.byteLength);
      callerOnVideoChunk?.(chunk, iVideoChunk++);
    },
    onAudioChunk(chunk) {
      onAudioBytes(chunk.byteLength);
      callerOnAudioChunk?.(chunk, iAudioChunk++);
    }
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
    onTrackChunk: ({ trackIndex, chunk }) => onExtraTrackBytes({
      trackIndex,
      bytes: chunk.byteLength
    })
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
