import type { DownloadResult } from "./background-downloader";
import { createProgressFetch } from "./progress-fetch";
import { sendProgressUpdate } from "./progress-fetch";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/youtube/sabr-download";
import { DownloadType, ProgressType } from "@/types";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig } from "@/types";

export function buildEffectiveSabrConfig(sabrConfig: SabrConfig, sabrUrl: string | undefined): SabrConfig {
  if (sabrUrl && sabrUrl !== sabrConfig.serverAbrStreamingUrl) {
    return { ...sabrConfig, serverAbrStreamingUrl: sabrUrl };
  }

  return sabrConfig;
}

export function parseContentLength(format: AdaptiveFormatItem | null) {
  if (!format?.contentLength) {
    return 0;
  }

  return parseInt(format.contentLength, 10);
}

async function downloadAudioOnlyViaSabr(
  config: SabrConfig,
  audioFormat: AdaptiveFormatItem,
  poToken: string,
  signal: AbortSignal,
  videoId: string,
  tabId: number
) {
  const audioExpectedBytes = parseContentLength(audioFormat);
  let audioReceivedBytes = 0;

  const sabrFetch = createProgressFetch(signal, bytes => {
    audioReceivedBytes += bytes;
    const totalBytes = audioExpectedBytes || audioReceivedBytes;
    void sendProgressUpdate(videoId, Math.min(audioReceivedBytes / totalBytes, 1), ProgressType.Video, tabId);
  });

  return fetchAudioViaSabrStream(config, audioFormat, sabrFetch, poToken);
}

async function downloadVideoAudioViaSabr(
  config: SabrConfig,
  videoFormat: AdaptiveFormatItem,
  audioFormat: AdaptiveFormatItem,
  poToken: string,
  signal: AbortSignal,
  videoId: string,
  tabId: number
) {
  const totalExpectedBytes = parseContentLength(videoFormat) + parseContentLength(audioFormat);
  let videoReceivedBytes = 0;
  let audioReceivedBytes = 0;

  function reportProgress() {
    const totalReceived = videoReceivedBytes + audioReceivedBytes;
    const totalExpected = totalExpectedBytes || totalReceived;
    if (totalExpected === 0) {
      return;
    }

    void sendProgressUpdate(videoId, Math.min(totalReceived / totalExpected, 1), ProgressType.Video, tabId);
  }

  const videoFetch = createProgressFetch(signal, bytes => {
    videoReceivedBytes += bytes; reportProgress();
  });
  const audioFetch = createProgressFetch(signal, bytes => {
    audioReceivedBytes += bytes; reportProgress();
  });

  return Promise.all([
    fetchVideoViaSabrStream(config, videoFormat, videoFetch, poToken),
    fetchAudioViaSabrStream(config, audioFormat, audioFetch, poToken)
  ]);
}

async function downloadExtraAudioTracksViaSabr(
  config: SabrConfig,
  formats: AdaptiveFormatItem[],
  poToken: string,
  signal: AbortSignal
) {
  const tracks: DownloadResult["additionalAudioTracks"] = [];

  for (const format of formats) {
    try {
      const sabrFetch = createProgressFetch(signal, () => {});
      const data = await fetchAudioViaSabrStream(config, format, sabrFetch, poToken);
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

export async function downloadViaSabr(
  request: DownloadRequest,
  signal: AbortSignal,
  tabId: number
): Promise<DownloadResult | null> {
  const { videoId, type, sabrConfig, poToken, sabrUrl, videoFormat, audioFormat, additionalAudioFormats } = request;
  const isAudioOnly = type === DownloadType.Audio;

  const effectiveConfig = sabrConfig ? buildEffectiveSabrConfig(sabrConfig, sabrUrl) : null;
  const isSabrAvailable = Boolean(effectiveConfig && audioFormat && (isAudioOnly || videoFormat));
  if (!isSabrAvailable) {
    return null;
  }

  const resolvedPoToken = poToken ?? "";
  if (isAudioOnly) {
    const audioData = await downloadAudioOnlyViaSabr(
      effectiveConfig!, audioFormat!, resolvedPoToken, signal, videoId, tabId
    );
    return { videoData: null, audioData, additionalAudioTracks: [] };
  }

  const [videoData, audioData] = await downloadVideoAudioViaSabr(
    effectiveConfig!, videoFormat!, audioFormat!, resolvedPoToken, signal, videoId, tabId
  );
  const additionalAudioTracks = await downloadExtraAudioTracksViaSabr(
    effectiveConfig!, additionalAudioFormats ?? [], resolvedPoToken, signal
  );

  return { videoData, audioData, additionalAudioTracks };
}
