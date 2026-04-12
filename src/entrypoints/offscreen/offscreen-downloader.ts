import { enqueueStreamData } from "@/lib/download-pipeline";
import { MessageType, sendMessage } from "@/lib/messaging";
import { createProgressFetch, fetchWithProgress, sendProgressUpdate } from "@/lib/progress-fetch";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/sabr-download";
import { fetchYouTubeMusicMetadata } from "@/lib/youtube-music-metadata";
import { DownloadType, ProgressType } from "@/types";
import type {
  AdaptiveFormatItem,
  AudioStreamData,
  DownloadRequest,
  ProcessStreamData,
  SabrConfig,
  VideoMetadata
} from "@/types";

const activeOffscreenDownloads = new Map<string, AbortController>();

export function cancelOffscreenDownload(videoId: string) {
  const controller = activeOffscreenDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeOffscreenDownloads.delete(videoId);
}

interface DownloadResult {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  additionalAudioTracks: Array<{
    data: Uint8Array | null; mimeType: string; label: string;
  }>;
}

function buildEffectiveSabrConfig(sabrConfig: SabrConfig, sabrUrl: string | undefined) {
  if (sabrUrl && sabrUrl !== sabrConfig.serverAbrStreamingUrl) {
    return { ...sabrConfig, serverAbrStreamingUrl: sabrUrl };
  }

  return sabrConfig;
}

function parseContentLength(format: AdaptiveFormatItem | null) {
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
      const fetch = createProgressFetch(signal, () => {});
      const data = await fetchAudioViaSabrStream(config, format, fetch, poToken);
      tracks.push({
        data,
        mimeType: format.mimeType.split(";")[0] ?? "audio/mp4",
        label: format.audioTrack?.displayName ?? ""
      });
    } catch (trackError) {
      console.warn("[ytdl:offscreen] Extra audio track failed:", format.audioTrack?.displayName, trackError);
    }
  }

  return tracks;
}

async function downloadViaSabr(
  request: DownloadRequest,
  signal: AbortSignal,
  tabId: number
): Promise<DownloadResult | null> {
  const { videoId, type, sabrConfig, poToken, sabrUrl, videoFormat, audioFormat, additionalAudioFormats } = request;
  const isAudioOnly = type === DownloadType.Audio;

  const effectiveConfig = sabrConfig ? buildEffectiveSabrConfig(sabrConfig, sabrUrl) : null;
  const canUseSabr = Boolean(effectiveConfig && audioFormat && (isAudioOnly || videoFormat));
  if (!canUseSabr) {
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

async function downloadViaCdn(
  request: DownloadRequest,
  signal: AbortSignal,
  videoId: string,
  tabId: number
): Promise<DownloadResult | null> {
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

    void sendProgressUpdate(videoId, Math.min(totalReceived / totalExpected, 1), ProgressType.Video, tabId);
  }

  function fetchStream(url: string | null | undefined, onBytes: (bytes: number) => void) {
    if (!url) {
      return Promise.resolve(null);
    }

    return fetchWithProgress(url, signal, onBytes);
  }

  const extraUrls = resolvedExtraAudioUrls ?? [];
  const cdnResults = await Promise.all([
    type !== DownloadType.Audio
      ? fetchStream(resolvedVideoUrl, bytes => {
        videoReceivedBytes += bytes; videoTotalBytes = Math.max(videoTotalBytes, videoReceivedBytes); reportProgress();
      })
      : Promise.resolve(null),
    type !== DownloadType.Video
      ? fetchStream(resolvedAudioUrl, bytes => {
        audioReceivedBytes += bytes; audioTotalBytes = Math.max(audioTotalBytes, audioReceivedBytes); reportProgress();
      })
      : Promise.resolve(null),
    ...extraUrls.map(url => fetchStream(url, () => {}))
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

async function enrichMetadataFromYouTubeMusic(metadata: VideoMetadata | null | undefined) {
  if (!metadata?.isMusic) {
    return metadata;
  }

  const searchQuery = `${metadata.artist} ${metadata.title}`.trim();
  if (!searchQuery) {
    return metadata;
  }

  return fetchYouTubeMusicMetadata(searchQuery, metadata);
}

function buildProcessStreamData(
  request: DownloadRequest,
  result: DownloadResult,
  enrichedMetadata: VideoMetadata | null | undefined,
  tabId: number
): ProcessStreamData {
  const resolvedVideoMimeType = request.videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
  const resolvedAudioMimeType = request.audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";

  const additionalAudioStreams: AudioStreamData[] = result.additionalAudioTracks.map(track => ({
    data: track.data,
    mimeType: track.mimeType,
    label: track.label
  }));

  return {
    type: request.type,
    videoId: request.videoId,
    filenameOutput: request.filenameOutput,
    videoData: result.videoData,
    audioData: result.audioData,
    videoMimeType: resolvedVideoMimeType,
    audioMimeType: resolvedAudioMimeType,
    primaryAudioLabel: request.primaryAudioLabel,
    additionalAudioStreams,
    tabId,
    playlistId: request.playlistId,
    playlistTitle: request.playlistTitle,
    playlistTotalCount: request.playlistTotalCount,
    metadata: enrichedMetadata
  };
}

export async function startOffscreenDownload(request: DownloadRequest, tabId: number) {
  const { videoId, metadata } = request;
  cancelOffscreenDownload(videoId);
  const abortController = new AbortController();
  activeOffscreenDownloads.set(videoId, abortController);
  const { signal } = abortController;

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);

    let result: DownloadResult | null = null;

    try {
      result = await downloadViaSabr(request, signal, tabId);
    } catch (sabrError) {
      if (signal.aborted) {
        return;
      }

      console.warn("[ytdl:offscreen] SABR failed, trying CDN:", sabrError);
    }

    if (!result?.audioData) {
      try {
        result = await downloadViaCdn(request, signal, videoId, tabId);
      } catch (cdnError) {
        if (signal.aborted) {
          return;
        }

        console.warn("[ytdl:offscreen] CDN fetch failed:", cdnError);
        return;
      }
    }

    if (!result?.audioData && !result?.videoData) {
      console.warn("[ytdl:offscreen] No download method succeeded for", videoId);
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId, progress: 0, progressType: ProgressType.Video, isRemoved: true
      }, tabId);
      return;
    }

    const enrichedMetadata = await enrichedMetadataPromise;
    const streamData = buildProcessStreamData(request, result, enrichedMetadata, tabId);
    enqueueStreamData(streamData);
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    console.warn("[ytdl:offscreen] Download failed:", error);
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId, progress: 0, progressType: ProgressType.Video, isRemoved: true
    }, tabId);
  } finally {
    activeOffscreenDownloads.delete(videoId);
  }
}
