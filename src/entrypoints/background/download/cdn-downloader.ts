import type { DownloadResult } from "./background-downloader";
import { fetchWithProgress, sendProgressUpdate } from "./progress-fetch";
import { parseContentLength } from "./sabr-downloader";
import { stripMimeParams } from "@/lib/utils/containers";
import { stripTrackLangSuffix } from "@/lib/youtube/video-helpers";
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

  const videoExpectedBytes = parseContentLength(videoFormat ?? null);
  const audioExpectedBytes = parseContentLength(audioFormat ?? null);
  const extraExpectedBytes = (additionalAudioFormats ?? [])
    .reduce((sum, format) => sum + parseContentLength(format), 0);
  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;
  let extraReceivedBytes = 0;
  let videoTotalBytes = videoExpectedBytes;
  let audioTotalBytes = audioExpectedBytes;

  function reportProgress() {
    const totalReceived = videoReceivedBytes + audioReceivedBytes + extraReceivedBytes;
    const totalExpected = (videoTotalBytes + audioTotalBytes + extraExpectedBytes) || totalReceived;
    if (totalExpected === 0) {
      return;
    }

    void sendProgressUpdate({
      videoId,
      progress: Math.min(totalReceived / totalExpected, 1),
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

  const extraUrls = resolvedExtraAudioUrls ?? [];
  const cdnResults = await Promise.all([
    type !== DownloadType.Audio
      ? fetchStream({
        url: resolvedVideoUrl,
        onBytes(bytes) {
          videoReceivedBytes += bytes;
          videoTotalBytes = Math.max(videoTotalBytes, videoReceivedBytes);
          reportProgress();
        }
      })
      : Promise.resolve(null),
    type !== DownloadType.Video
      ? fetchStream({
        url: resolvedAudioUrl,
        onBytes(bytes) {
          audioReceivedBytes += bytes;
          audioTotalBytes = Math.max(audioTotalBytes, audioReceivedBytes);
          reportProgress();
        }
      })
      : Promise.resolve(null),
    ...extraUrls.map(url => fetchStream({
      url,
      onBytes(bytes) {
        extraReceivedBytes += bytes;
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
      label: stripTrackLangSuffix(format.audioTrack?.displayName ?? `Track ${i + 2}`),
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
