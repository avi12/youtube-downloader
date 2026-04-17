import type { DownloadResult } from "./background-downloader";
import { fetchWithProgress } from "./progress-fetch";
import { sendProgressUpdate } from "./progress-fetch";
import { parseContentLength } from "./sabr-downloader";
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
  if (!resolvedVideoUrl && !resolvedAudioUrl) {
    return null;
  }

  const videoExpectedBytes = parseContentLength(videoFormat ?? null);
  const audioExpectedBytes = parseContentLength(audioFormat ?? null);
  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;
  let videoTotalBytes = videoExpectedBytes;
  let audioTotalBytes = audioExpectedBytes;

  function reportProgress() {
    const totalReceived = videoReceivedBytes + audioReceivedBytes;
    const totalExpected = (videoTotalBytes + audioTotalBytes) || totalReceived;
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
      onBytes() {}
    }))
  ]);

  const additionalAudioTracks: DownloadResult["additionalAudioTracks"] = [];
  const extraAudioBytes = cdnResults.slice(2);
  for (const [i, format] of (additionalAudioFormats ?? []).entries()) {
    additionalAudioTracks.push({
      data: extraAudioBytes[i] ?? null,
      mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
      label: format.audioTrack?.displayName ?? `Track ${i + 2}`
    });
  }

  return {
    videoData: cdnResults[0] ?? null,
    audioData: cdnResults[1] ?? null,
    additionalAudioTracks
  };
}
