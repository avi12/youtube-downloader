import type { DownloadResult } from "./background-downloader";
import { fetchWithProgress } from "./progress-fetch";
import { sendProgressUpdate } from "./progress-fetch";
import { parseContentLength } from "./sabr-progress";
import { DownloadType, ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

function assembleAdditionalAudioTracks({
  extraAudioBytes,
  additionalAudioFormats
}: {
  extraAudioBytes: (Uint8Array | null)[];
  additionalAudioFormats: DownloadRequest["additionalAudioFormats"];
}) {
  const tracks: DownloadResult["additionalAudioTracks"] = [];
  for (const [i, format] of (additionalAudioFormats ?? []).entries()) {
    tracks.push({
      data: extraAudioBytes[i] ?? null,
      mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
      label: format.audioTrack?.displayName ?? `Track ${i + 2}`
    });
  }

  return tracks;
}

export async function downloadViaCdn({ request, signal, videoId, tabId }: {
  request: DownloadRequest;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
}) {
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

  async function fetchStream({ url, onBytes }: {
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

  const wantsVideo = type !== DownloadType.Audio;
  const wantsAudio = type !== DownloadType.Video;
  const extraUrls = resolvedExtraAudioUrls ?? [];

  const videoPromise = wantsVideo
    ? fetchStream({
      url: resolvedVideoUrl,
      onBytes(bytes) {
        videoReceivedBytes += bytes;
        videoTotalBytes = Math.max(videoTotalBytes, videoReceivedBytes);
        reportProgress();
      }
    })
    : Promise.resolve(null);

  const audioPromise = wantsAudio
    ? fetchStream({
      url: resolvedAudioUrl,
      onBytes(bytes) {
        audioReceivedBytes += bytes;
        audioTotalBytes = Math.max(audioTotalBytes, audioReceivedBytes);
        reportProgress();
      }
    })
    : Promise.resolve(null);

  const extraPromises = extraUrls.map(url => fetchStream({
    url,
    onBytes() {}
  }));

  const [videoData, audioData, ...extraAudioBytes] = await Promise.all([
    videoPromise,
    audioPromise,
    ...extraPromises
  ]);

  return {
    videoData: videoData ?? null,
    audioData: audioData ?? null,
    additionalAudioTracks: assembleAdditionalAudioTracks({
      extraAudioBytes,
      additionalAudioFormats
    })
  };
}
