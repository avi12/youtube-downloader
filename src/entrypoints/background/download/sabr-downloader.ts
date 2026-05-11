import type { DownloadResult } from "./background-downloader";
import { createProgressFetch, sendProgressUpdate } from "./progress-fetch";
import { stripMimeParams } from "@/lib/utils/containers";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr/download";
import { DownloadType, ProgressType } from "@/types";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig } from "@/types";

// Never report progress = 1 from inside the stream callbacks — the Promise.all
// may still be pending (e.g. audio has no contentLength so its bytes aren't counted
// in totalExpectedBytes). The FFmpeg dispatch sends the real "100% of download phase"
// signal once both streams have resolved.
const DOWNLOAD_PROGRESS_CAP = 0.99;

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

async function downloadExtraAudioTracksViaSabr({ config, formats, poToken, signal, onProgress, onExtraProgress }: {
  config: SabrConfig;
  formats: AdaptiveFormatItem[];
  poToken: string;
  signal: AbortSignal;
  onProgress?: () => void;
  onExtraProgress?: (completedExpectedBytes: number) => void;
}) {
  const results = [];
  let completedExpectedBytes = 0;

  for (const format of formats) {
    const trackExpectedBytes = parseContentLength(format);
    let trackReceivedBytes = 0;

    try {
      const sabrFetch = createProgressFetch({
        signal,
        onBytesReceived(bytes) {
          trackReceivedBytes += bytes;
          onProgress?.();

          if (trackExpectedBytes > 0) {
            onExtraProgress?.(completedExpectedBytes + Math.min(trackReceivedBytes, trackExpectedBytes));
          }
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
        label: (format.audioTrack?.displayName ?? "").replace(/ [-–—] \[.*?]$/, "").trim(),
        languageCode: format.audioTrack?.id?.split(".")[0] ?? "",
        isDefault: format.audioTrack?.audioIsDefault ?? false
      });
    } catch (trackError) {
      console.warn("[ytdl:bg] Extra audio track failed:", format.audioTrack?.displayName, trackError);
    }

    completedExpectedBytes += trackExpectedBytes;
    onExtraProgress?.(completedExpectedBytes);
  }

  return results;
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
  const extraExpectedBytes = (additionalAudioFormats ?? [])
    .reduce((sum, format) => sum + parseContentLength(format), 0);
  const totalExpectedBytes = mainExpectedBytes + extraExpectedBytes;

  let totalReceivedBytes = 0;

  function onBytesReceived(bytes: number) {
    totalReceivedBytes += bytes;
    onProgress?.();
    const hasExpectedSize = totalExpectedBytes > 0;
    if (hasExpectedSize) {
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
    formats: additionalAudioFormats ?? [],
    poToken: resolvedPoToken,
    signal,
    onProgress,
    onExtraProgress: totalExpectedBytes > 0 ? completedExtraBytes => {
      void sendProgressUpdate({
        videoId,
        progress: Math.min((mainExpectedBytes + completedExtraBytes) / totalExpectedBytes, DOWNLOAD_PROGRESS_CAP),
        progressType: ProgressType.Video,
        tabId
      });
    } : undefined
  });

  return {
    videoData,
    audioData,
    additionalAudioTracks
  };
}
