import { downloadViaCdn } from "../background/download/cdn-downloader";
import { downloadViaSabr } from "../background/download/sabr-downloader";
import { buildSubtitleTracks } from "../background/download/stream-chunk-transfer";
import type { ProcessStreamEndData } from "@/lib/messaging/offscreen-messaging";
import { stripMimeParams } from "@/lib/utils/containers";
import { DownloadType, StreamType } from "@/types";
import type { DownloadRequest, VideoMetadata } from "@/types";

const SABR_STALL_TIMEOUT_MS = 10_000;
const SABR_FIRST_BYTE_TIMEOUT_MS = 5_000;

const abortController = new AbortController();
const { signal } = abortController;

addEventListener("message", e => {
  if (e.origin !== location.origin) {
    return;
  }

  if (e.data?.type === "cancel") {
    abortController.abort();
  }

  if (e.data?.type === "start") {
    const { request, tabId, enrichedMetadata } = e.data;
    void runDownload(request, tabId, enrichedMetadata);
  }
}, { once: false });

async function trySabrWithStallTimer(request: DownloadRequest, tabId: number) {
  const sabrAbortController = new AbortController();
  let sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_FIRST_BYTE_TIMEOUT_MS);
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
      onProgress: resetSabrStallTimer
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    console.warn("[ytdl:worker] SABR failed, trying CDN:", error);
    return null;
  } finally {
    clearTimeout(sabrStallTimeoutId);
  }
}

function sendChunkToParent(videoId: string, streamType: string, tabId: number) {
  return (chunk: Uint8Array, iChunk: number) => {
    const buffer = new ArrayBuffer(chunk.byteLength);
    new Uint8Array(buffer).set(chunk);
    parent.postMessage(
      {
        type: "worker-chunk",
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

function sendStreamEndToParent(videoId: string, streamType: string) {
  return (totalChunks: number) => {
    parent.postMessage(
      {
        type: "worker-stream-end",
        videoId,
        streamType,
        totalChunks
      },
      location.origin
    );
  };
}

function buildStreamEnd({
  request, tabId, enrichedMetadata, additionalAudioTrackLabels, additionalAudioLanguageCodes
}: {
  request: DownloadRequest;
  tabId: number;
  enrichedMetadata: VideoMetadata | null;
  additionalAudioTrackLabels: string[];
  additionalAudioLanguageCodes: string[];
}): ProcessStreamEndData {
  const {
    videoId, type, filenameOutput, videoFormat, audioFormat,
    primaryAudioLabel, primaryAudioLanguageCode,
    captionTracks, captionVttData,
    playlistId, playlistTitle, playlistTotalCount
  } = request;
  const videoMimeType = videoFormat ? stripMimeParams(videoFormat.mimeType) : "video/mp4";
  const audioMimeType = audioFormat ? stripMimeParams(audioFormat.mimeType) : "audio/mp4";
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
    metadata: enrichedMetadata
  };
}

async function runDownload(request: DownloadRequest, tabId: number, enrichedMetadata: VideoMetadata | null) {
  const { videoId, type, resolvedVideoUrl, resolvedAudioUrl } = request;

  try {
    const sabrResult = await trySabrWithStallTimer(request, tabId);
    if (signal.aborted) {
      return;
    }

    const hasNoAudioData = !(sabrResult?.audioData?.byteLength) && !sabrResult?.streamedToOffscreen;
    const needsCdn = hasNoAudioData || sabrResult?.isPartialVideo || sabrResult?.isPartialAudio;
    const hasCdnUrls = !!(resolvedVideoUrl || resolvedAudioUrl);
    const isAudioOnly = type === DownloadType.Audio;

    let cdnResult = null;
    if (needsCdn && hasCdnUrls) {
      const partialAudioData = sabrResult?.isPartialAudio ? (sabrResult.audioData ?? undefined) : undefined;
      const useStreaming = !isAudioOnly && !partialAudioData;

      cdnResult = await downloadViaCdn({
        request,
        signal,
        videoId,
        tabId,
        partialAudioData,
        ...(useStreaming && {
          onVideoChunk: sendChunkToParent(videoId, StreamType.Video, tabId),
          onAudioChunk: sendChunkToParent(videoId, StreamType.Audio, tabId),
          onVideoStreamEnd: sendStreamEndToParent(videoId, StreamType.Video),
          onAudioStreamEnd: sendStreamEndToParent(videoId, StreamType.Audio)
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
    const hasNoData = !result
      || (!(result.videoData?.byteLength) && !(result.audioData?.byteLength) && !result.streamedToOffscreen);
    if (hasNoData) {
      const isDirectUrlEligible = isAudioOnly && !!resolvedAudioUrl;
      if (isDirectUrlEligible) {
        parent.postMessage(
          {
            type: "worker-needs-direct-url",
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
          type: "worker-needs-fallback",
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
      .map(toArrayBuffer);

    const transferList: ArrayBuffer[] = [...extraAudioBuffers];
    const completeMsg: Record<string, unknown> = {
      type: "worker-complete",
      videoId,
      isStreamed,
      streamEnd,
      extraAudioBuffers
    };
    if (!isStreamed) {
      if (result.videoData?.byteLength) {
        const videoBuffer = toArrayBuffer(result.videoData);
        transferList.push(videoBuffer);
        completeMsg.videoBuffer = videoBuffer;
      }

      if (result.audioData?.byteLength) {
        const audioBuffer = toArrayBuffer(result.audioData);
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
        type: "worker-error",
        videoId,
        tabId,
        error: String(error)
      },
      location.origin
    );
  }
}
