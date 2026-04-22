import type { DownloadResult } from "./background-downloader";
import { createProgressFetch } from "./progress-fetch";
import { sendProgressUpdate } from "./progress-fetch";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr-download";
import { DownloadType, ProgressType } from "@/types";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig } from "@/types";

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

  return fetchAudioViaSabrStream({
    sabrConfig: config,
    audioFormat,
    fetchFn: sabrFetch,
    poToken
  });
}

async function downloadVideoAudioViaSabr({
  config, videoFormat, audioFormat, poToken, signal, videoId, tabId, onProgress, firstBodyOverride
}: {
  config: SabrConfig;
  videoFormat: AdaptiveFormatItem;
  audioFormat: AdaptiveFormatItem;
  poToken: string;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  onProgress?: () => void;
  firstBodyOverride?: Uint8Array;
}) {
  const totalExpectedBytes = parseContentLength(videoFormat) + parseContentLength(audioFormat);
  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;

  function reportProgress() {
    if (totalExpectedBytes === 0) {
      return;
    }

    const totalReceived = videoReceivedBytes + audioReceivedBytes;

    void sendProgressUpdate({
      videoId,
      progress: Math.min(totalReceived / totalExpectedBytes, 1),
      progressType: ProgressType.Video,
      tabId
    });
  }

  const videoFetch = createProgressFetch({
    signal,
    firstBodyOverride,
    onBytesReceived(bytes) {
      videoReceivedBytes += bytes;
      onProgress?.();
      reportProgress();
    }
  });
  const audioFetch = createProgressFetch({
    signal,
    firstBodyOverride,
    onBytesReceived(bytes) {
      audioReceivedBytes += bytes;
      onProgress?.();
      reportProgress();
    }
  });

  return Promise.all([
    fetchVideoViaSabrStream({
      sabrConfig: config,
      videoFormat,
      fetchFn: videoFetch,
      poToken
    }),
    fetchAudioViaSabrStream({
      sabrConfig: config,
      audioFormat,
      fetchFn: audioFetch,
      poToken
    })
  ]);
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

export async function downloadViaSabr({ request, signal, tabId, onProgress, firstBodyOverride }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
  onProgress?: () => void;
  firstBodyOverride?: Uint8Array;
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

  // On Firefox, our minted PO token triggers attestation-required even
  // though YT player's captured body (with EMPTY PO token) works. Send an
  // empty string so SabrStream omits the poToken field entirely.
  const resolvedPoToken = import.meta.env.FIREFOX ? "" : (poToken ?? "");
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
    firstBodyOverride,
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
