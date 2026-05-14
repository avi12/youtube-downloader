import type { DownloadResult } from "./background-downloader";
import { fetchWithProgress } from "./cdn-fetch";
import { createCdnProgressTracker } from "./cdn-progress";
import { parseContentLength } from "./sabr-utils";
import { stripMimeParams } from "@/lib/utils/containers";
import { DownloadType } from "@/types";
import type { DownloadRequest } from "@/types";

function fetchStream(
  url: string | null | undefined, signal: AbortSignal, onBytes: (n: number) => void, initialData?: Uint8Array
) {
  if (!url) {
    return Promise.resolve(null);
  }

  return fetchWithProgress({
    url,
    signal,
    onBytesReceived: onBytes,
    initialData
  });
}

export async function downloadViaCdn({ request, signal, videoId, tabId, partialVideoData, partialAudioData }: {
  request: DownloadRequest;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  partialVideoData?: Uint8Array;
  partialAudioData?: Uint8Array;
}): Promise<DownloadResult | null> {
  const {
    type, videoFormat, audioFormat,
    resolvedVideoUrl, resolvedAudioUrl, resolvedExtraAudioUrls, additionalAudioFormats
  } = request;
  if (!resolvedVideoUrl && !resolvedAudioUrl) {
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

  const cdnResults = await Promise.all([
    hasVideo ? fetchStream(resolvedVideoUrl, signal, tracker.onVideoBytes, partialVideoData) : Promise.resolve(null),
    hasAudio ? fetchStream(resolvedAudioUrl, signal, tracker.onAudioBytes, partialAudioData) : Promise.resolve(null),
    ...extraUrls.map((url, i) => fetchStream(url, signal, bytes => tracker.onExtraBytes(i, bytes)))
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
