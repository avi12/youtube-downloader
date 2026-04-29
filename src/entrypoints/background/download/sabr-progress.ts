import type { DownloadResult } from "./background-downloader";
import { createProgressFetch, sendProgressUpdate } from "./progress-fetch";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr-download";
import { ProgressType } from "@/types";
import type { AdaptiveFormatItem, SabrConfig } from "@/types";

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

export async function downloadAudioOnlyViaSabr({ config, audioFormat, poToken, signal, videoId, tabId, onProgress }: {
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

export async function downloadVideoAudioViaSabr({
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
  const videoExpectedBytes = parseContentLength(videoFormat);
  const audioExpectedBytes = parseContentLength(audioFormat);
  const totalExpectedBytes = videoExpectedBytes + audioExpectedBytes;
  let totalReceivedBytes = 0;

  function makeProgressFetch() {
    return createProgressFetch({
      signal,
      onBytesReceived(bytes) {
        totalReceivedBytes += bytes;
        onProgress?.();

        if (totalExpectedBytes > 0) {
          void sendProgressUpdate({
            videoId,
            progress: Math.min(totalReceivedBytes / totalExpectedBytes, 1),
            progressType: ProgressType.Video,
            tabId
          });
        }
      }
    });
  }

  return Promise.all([
    fetchVideoViaSabrStream({
      sabrConfig: config,
      videoFormat,
      fetchFn: makeProgressFetch(),
      poToken
    }),
    fetchAudioViaSabrStream({
      sabrConfig: config,
      audioFormat,
      fetchFn: makeProgressFetch(),
      poToken
    })
  ]);
}

export async function downloadExtraAudioTracksViaSabr({ config, formats, poToken, signal, onProgress }: {
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
