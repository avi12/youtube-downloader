import type { DownloadResult } from "./background-downloader";
import { fetchWithProgress, sendProgressUpdate } from "./progress-fetch";
import { parseContentLength } from "./sabr-downloader";
import { stripMimeParams } from "@/lib/utils/containers";
import { DownloadType, ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export async function downloadViaCdn({ request, signal, videoId, tabId }: {
  request: DownloadRequest;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
}): Promise<DownloadResult | null> {
  const {
    type, videoFormat, audioFormat, resolvedVideoUrl,
    resolvedAudioUrl, resolvedExtraAudioUrls, additionalAudioFormats
  } = request;
  const hasNoResolvedUrls = !resolvedVideoUrl && !resolvedAudioUrl;
  if (hasNoResolvedUrls) {
    return null;
  }

  const captionCount = request.captionTracks?.length ?? 0;
  const extraUrls = resolvedExtraAudioUrls ?? [];
  const hasVideo = type !== DownloadType.Audio;
  const hasAudio = type !== DownloadType.Video;
  const totalStages = captionCount + (hasVideo ? 1 : 0) + (hasAudio ? 1 : 0) + extraUrls.length;

  const videoExpectedBytes = parseContentLength(videoFormat ?? null);
  const audioExpectedBytes = parseContentLength(audioFormat ?? null);
  const extraExpectedBytesArr = (additionalAudioFormats ?? []).map(format => parseContentLength(format));

  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;
  const extraReceivedBytesArr = extraUrls.map(() => 0);
  let videoTotalBytes = videoExpectedBytes;
  let audioTotalBytes = audioExpectedBytes;

  function reportProgress() {
    if (totalStages === 0) {
      return;
    }

    // Captions are pre-fetched in the content script - count as completed stages
    let completed = captionCount;
    if (hasVideo) {
      const expected = videoTotalBytes || videoReceivedBytes;
      if (expected > 0) {
        completed += Math.min(videoReceivedBytes / expected, 1);
      }
    }

    if (hasAudio) {
      const expected = audioTotalBytes || audioReceivedBytes;
      if (expected > 0) {
        completed += Math.min(audioReceivedBytes / expected, 1);
      }
    }

    for (const [i, expected] of extraExpectedBytesArr.entries()) {
      const effectiveExpected = expected || extraReceivedBytesArr[i];
      if (effectiveExpected > 0) {
        completed += Math.min(extraReceivedBytesArr[i] / effectiveExpected, 1);
      }
    }

    void sendProgressUpdate({
      videoId,
      progress: Math.min(completed / totalStages, 1),
      progressType: ProgressType.Video,
      tabId
    });
  }

  function fetchStream({ url, onBytes }: {
    url: string | null | undefined;
    onBytes: (bytes: number) => void;
  }) {
    if (!url) {
      return Promise.resolve(null);
    }

    return fetchWithProgress({
      url,
      signal,
      onBytesReceived: onBytes
    });
  }

  const cdnResults = await Promise.all([
    hasVideo
      ? fetchStream({
        url: resolvedVideoUrl,
        onBytes(bytes) {
          videoReceivedBytes += bytes;
          videoTotalBytes = Math.max(videoTotalBytes, videoReceivedBytes);
          reportProgress();
        }
      })
      : Promise.resolve(null),
    hasAudio
      ? fetchStream({
        url: resolvedAudioUrl,
        onBytes(bytes) {
          audioReceivedBytes += bytes;
          audioTotalBytes = Math.max(audioTotalBytes, audioReceivedBytes);
          reportProgress();
        }
      })
      : Promise.resolve(null),
    ...extraUrls.map((url, i) => fetchStream({
      url,
      onBytes(bytes) {
        extraReceivedBytesArr[i] += bytes;
        reportProgress();
      }
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

  const [videoData = null, audioData = null] = cdnResults;
  return {
    videoData,
    audioData,
    additionalAudioTracks
  };
}
