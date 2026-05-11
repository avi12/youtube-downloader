import type { DownloadResult } from "./background-downloader";
import { createProgressFetch, sendProgressUpdate } from "./progress-fetch";
import { stripMimeParams } from "@/lib/utils/containers";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr/download";
import { DownloadType, ProgressType } from "@/types";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig } from "@/types";

const DOWNLOAD_PROGRESS_CAP = 1;

export function buildEffectiveSabrConfig({ sabrConfig, sabrUrl }: {
  sabrConfig: SabrConfig;
  sabrUrl: string | undefined;
}) {
  const isCustomSabrUrl = sabrUrl && sabrUrl !== sabrConfig.serverAbrStreamingUrl;
  if (isCustomSabrUrl) {
    return {
      ...sabrConfig,
      serverAbrStreamingUrl: sabrUrl
    };
  }

  return sabrConfig;
}

export function parseContentLength(format: AdaptiveFormatItem | null) {
  if (!format?.contentLength) {
    return 0;
  }

  return parseInt(format.contentLength, 10);
}

async function downloadAudioOnlyViaSabr({ config, audioFormat, poToken, signal, onBytesReceived }: {
  config: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  onBytesReceived?: (bytes: number) => void;
}) {
  const sabrFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      onBytesReceived?.(bytes);
    }
  });

  return fetchAudioViaSabrStream({
    sabrConfig: config,
    audioFormat,
    fetchFn: sabrFetch,
    poToken,
    signal
  });
}

async function downloadVideoAudioViaSabr({
  config, videoFormat, audioFormat, poToken, signal, onVideoBytesReceived, onAudioBytesReceived
}: {
  config: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  onVideoBytesReceived?: (bytes: number) => void;
  onAudioBytesReceived?: (bytes: number) => void;
}) {
  const videoFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      onVideoBytesReceived?.(bytes);
    }
  });
  const audioFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      onAudioBytesReceived?.(bytes);
    }
  });

  return Promise.all([
    fetchVideoViaSabrStream({
      sabrConfig: config,
      videoFormat,
      fetchFn: videoFetch,
      poToken,
      signal
    }),
    fetchAudioViaSabrStream({
      sabrConfig: config,
      audioFormat,
      fetchFn: audioFetch,
      poToken,
      signal
    })
  ]);
}

async function downloadExtraAudioTracksViaSabr({ config, formats, poToken, signal, onTrackBytesReceived }: {
  config: SabrConfig;
  formats: AdaptiveFormatItem[];
  poToken: string;
  signal: AbortSignal;
  onTrackBytesReceived?: (trackIndex: number, bytes: number) => void;
}) {
  const results = [];

  for (const [i, format] of formats.entries()) {
    try {
      const sabrFetch = createProgressFetch({
        signal,
        onBytesReceived(bytes) {
          onTrackBytesReceived?.(i, bytes);
        }
      });
      const data = await fetchAudioViaSabrStream({
        sabrConfig: config,
        audioFormat: format,
        fetchFn: sabrFetch,
        poToken,
        signal
      });
      results.push({
        data,
        mimeType: stripMimeParams(format.mimeType),
        label: format.audioTrack?.displayName ?? "",
        languageCode: format.audioTrack?.id?.split(".")[0] ?? "",
        isDefault: format.audioTrack?.audioIsDefault ?? false
      });
    } catch (trackError) {
      console.warn("[ytdl:bg] Extra audio track failed:", format.audioTrack?.displayName, trackError);
    }
  }

  return results;
}

function estimateFormatBytes(format: AdaptiveFormatItem, referenceFormat: AdaptiveFormatItem): number {
  const referenceBytes = parseContentLength(referenceFormat);
  if (!referenceBytes) {
    return 0;
  }

  const referenceBitrate = referenceFormat.bitrate || 1;
  const formatBitrate = format.bitrate || referenceBitrate;
  return Math.round(referenceBytes * formatBitrate / referenceBitrate);
}

export async function downloadViaSabr({ request, signal, tabId, onProgress }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
}): Promise<DownloadResult | null> {
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

  const videoPartBytes = isAudioOnly ? 0 : parseContentLength(videoFormat ?? null);
  const audioPartBytes = parseContentLength(audioFormat);
  const extraExpectedBytesArr = additionalFormats.map(format => {
    const known = parseContentLength(format);
    return known > 0 ? known : estimateFormatBytes(format, audioFormat);
  });

  const downloadStages = (!isAudioOnly && videoFormat ? 1 : 0) + 1 + additionalFormats.length;
  const totalStages = captionCount + downloadStages;

  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;
  const extraReceivedBytesArr = additionalFormats.map(() => 0);

  function computeProgress() {
    if (totalStages === 0) {
      return 0;
    }

    // Captions are pre-fetched in the content script - count as completed stages
    let completed = captionCount;
    if (!isAudioOnly && videoPartBytes > 0) {
      completed += Math.min(videoReceivedBytes / videoPartBytes, 1);
    }

    if (audioPartBytes > 0) {
      completed += Math.min(audioReceivedBytes / audioPartBytes, 1);
    }

    for (const [i, expected] of extraExpectedBytesArr.entries()) {
      if (expected > 0) {
        completed += Math.min(extraReceivedBytesArr[i] / expected, 1);
      }
    }

    return Math.min(completed / totalStages, DOWNLOAD_PROGRESS_CAP);
  }

  function sendUpdate() {
    onProgress?.();
    void sendProgressUpdate({
      videoId,
      progress: computeProgress(),
      progressType: ProgressType.Video,
      tabId
    });
  }

  const resolvedPoToken = poToken ?? "";
  if (isAudioOnly) {
    const audioData = await downloadAudioOnlyViaSabr({
      config: effectiveConfig,
      audioFormat,
      poToken: resolvedPoToken,
      signal,
      onBytesReceived(bytes) {
        audioReceivedBytes += bytes;
        sendUpdate();
      }
    });
    return {
      videoData: null,
      audioData,
      additionalAudioTracks: []
    };
  }

  if (!videoFormat) {
    return null;
  }

  const [videoData, audioData] = await downloadVideoAudioViaSabr({
    config: effectiveConfig,
    videoFormat,
    audioFormat,
    poToken: resolvedPoToken,
    signal,
    onVideoBytesReceived(bytes) {
      videoReceivedBytes += bytes;
      sendUpdate();
    },
    onAudioBytesReceived(bytes) {
      audioReceivedBytes += bytes;
      sendUpdate();
    }
  });
  const additionalAudioTracks = await downloadExtraAudioTracksViaSabr({
    config: effectiveConfig,
    formats: additionalFormats,
    poToken: resolvedPoToken,
    signal,
    onTrackBytesReceived(trackIndex, bytes) {
      extraReceivedBytesArr[trackIndex] += bytes;
      sendUpdate();
    }
  });

  return {
    videoData,
    audioData,
    additionalAudioTracks
  };
}
