import type { DownloadResult } from "./background-downloader";
import { createProgressFetch } from "./progress-fetch";
import { sendProgressUpdate } from "./progress-fetch";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { fetchAudioViaSabrStream, fetchVideoAudioViaSabrStream } from "@/lib/youtube/sabr-download";
import { DownloadType, ProgressType } from "@/types";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig } from "@/types";

const latestPoTokenByVideoId = new Map<string, string>();

export function registerPoTokenRefreshListener() {
  onMessage(MessageType.PoTokenRefreshed, ({ data }) => {
    latestPoTokenByVideoId.set(data.videoId, data.poToken);
  });
}

function takeRefreshedPoToken(videoId: string, lastUsed: string) {
  const latest = latestPoTokenByVideoId.get(videoId);
  if (!latest || latest === lastUsed) {
    return null;
  }

  return latest;
}

export function buildEffectiveSabrConfig({ sabrConfig, sabrUrl }: {
  sabrConfig: SabrConfig;
  sabrUrl: string | undefined;
}): SabrConfig {
  if (sabrUrl && sabrUrl !== sabrConfig.serverAbrStreamingUrl) {
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

async function downloadAudioOnlyViaSabr({ config, audioFormat, poToken, signal, videoId, tabId, onProgress }: {
  config: SabrConfig;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  onProgress?: () => void;
}) {
  const audioExpectedBytes = parseContentLength(audioFormat);
  let audioReceivedBytes = 0;

  const sabrFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      audioReceivedBytes += bytes;
      onProgress?.();
      const totalBytes = audioExpectedBytes || audioReceivedBytes;
      void sendProgressUpdate({
        videoId,
        progress: Math.min(audioReceivedBytes / totalBytes, 1),
        progressType: ProgressType.Video,
        tabId
      });
    }
  });

  let lastAppliedToken = poToken;
  return fetchAudioViaSabrStream({
    sabrConfig: config,
    audioFormat,
    fetchFn: sabrFetch,
    poToken,
    async refreshToken() {
      const next = takeRefreshedPoToken(videoId, lastAppliedToken);
      if (next) {
        lastAppliedToken = next;
      }

      return next;
    }
  });
}

async function downloadVideoAudioViaSabr({
  config, videoFormat, audioFormat, poToken, signal, videoId, tabId, onProgress
}: {
  config: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  onProgress?: () => void;
}) {
  const totalExpectedBytes = parseContentLength(videoFormat) + parseContentLength(audioFormat);
  let totalReceivedBytes = 0;

  function reportProgress() {
    if (totalExpectedBytes === 0) {
      return;
    }

    void sendProgressUpdate({
      videoId,
      progress: Math.min(totalReceivedBytes / totalExpectedBytes, 1),
      progressType: ProgressType.Video,
      tabId
    });
  }

  const combinedFetch = createProgressFetch({
    signal,
    onBytesReceived(bytes) {
      totalReceivedBytes += bytes;
      onProgress?.();
      reportProgress();
    }
  });

  let lastAppliedToken = poToken;
  const { videoData, audioData } = await fetchVideoAudioViaSabrStream({
    sabrConfig: config,
    videoFormat,
    audioFormat,
    fetchFn: combinedFetch,
    poToken,
    async refreshToken() {
      const next = takeRefreshedPoToken(videoId, lastAppliedToken);
      if (next) {
        lastAppliedToken = next;
      }

      return next;
    }
  });
  return [videoData, audioData];
}

async function downloadExtraAudioTracksViaSabr({ config, formats, poToken, signal, onProgress }: {
  config: SabrConfig;
  formats: AdaptiveFormatItem[];
  poToken: string;
  signal: AbortSignal;
  onProgress?: () => void;
}) {
  const tracks: DownloadResult["additionalAudioTracks"] = [];

  for (const format of formats) {
    try {
      const sabrFetch = createProgressFetch({
        signal,
        onBytesReceived() {
          onProgress?.();
        }
      });
      const data = await fetchAudioViaSabrStream({
        sabrConfig: config,
        audioFormat: format,
        fetchFn: sabrFetch,
        poToken
      });
      tracks.push({
        data,
        mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
        label: format.audioTrack?.displayName ?? ""
      });
    } catch (trackError) {
      console.warn("[ytdl:bg] Extra audio track failed:", format.audioTrack?.displayName, trackError);
    }
  }

  return tracks;
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
  if (!effectiveConfig || !audioFormat) {
    return null;
  }

  if (!isAudioOnly && !videoFormat) {
    return null;
  }

  const resolvedPoToken = poToken ?? "";
  if (isAudioOnly) {
    const audioData = await downloadAudioOnlyViaSabr({
      config: effectiveConfig,
      audioFormat,
      poToken: resolvedPoToken,
      signal,
      videoId,
      tabId,
      onProgress
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
    videoId,
    tabId,
    onProgress
  });
  const additionalAudioTracks = await downloadExtraAudioTracksViaSabr({
    config: effectiveConfig,
    formats: additionalAudioFormats ?? [],
    poToken: resolvedPoToken,
    signal,
    onProgress
  });

  return {
    videoData,
    audioData,
    additionalAudioTracks
  };
}
