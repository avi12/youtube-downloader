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
  config, videoFormat, audioFormat, poToken, signal, onBytesReceived
}: {
  config: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  onBytesReceived?: (bytes: number) => void;
}) {
  const videoFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      onBytesReceived?.(bytes);
    }
  });
  const audioFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      onBytesReceived?.(bytes);
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

async function downloadExtraAudioTracksViaSabr({ config, formats, poToken, signal, onBytesReceived }: {
  config: SabrConfig;
  formats: AdaptiveFormatItem[];
  poToken: string;
  signal: AbortSignal;
  onBytesReceived?: (bytes: number) => void;
}) {
  const results = [];

  for (const format of formats) {
    try {
      const sabrFetch = createProgressFetch({
        signal,
        onBytesReceived(bytes) {
          onBytesReceived?.(bytes);
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

  const videoPartBytes = isAudioOnly ? 0 : parseContentLength(videoFormat ?? null);
  const mainExpectedBytes = videoPartBytes + parseContentLength(audioFormat);
  const additionalFormats = additionalAudioFormats ?? [];
  const extraExpectedBytes = additionalFormats.reduce((sum, format) => {
    const known = parseContentLength(format);
    return sum + (known > 0 ? known : estimateFormatBytes(format, audioFormat));
  }, 0);
  const totalExpectedBytes = mainExpectedBytes + extraExpectedBytes;

  let totalReceivedBytes = 0;

  function onBytesReceived(bytes: number) {
    totalReceivedBytes += bytes;
    onProgress?.();

    if (totalExpectedBytes > 0) {
      void sendProgressUpdate({
        videoId,
        progress: Math.min(totalReceivedBytes / totalExpectedBytes, DOWNLOAD_PROGRESS_CAP),
        progressType: ProgressType.Video,
        tabId
      });
    }
  }

  const resolvedPoToken = poToken ?? "";
  if (isAudioOnly) {
    const audioData = await downloadAudioOnlyViaSabr({
      config: effectiveConfig,
      audioFormat,
      poToken: resolvedPoToken,
      signal,
      onBytesReceived
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
    onBytesReceived
  });
  const additionalAudioTracks = await downloadExtraAudioTracksViaSabr({
    config: effectiveConfig,
    formats: additionalFormats,
    poToken: resolvedPoToken,
    signal,
    onBytesReceived
  });

  return {
    videoData,
    audioData,
    additionalAudioTracks
  };
}
