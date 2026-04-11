import { ensureProcessor } from "./processor";
import { createProgressFetch, fetchWithProgress, sendProgressUpdate } from "./progress-fetch";
import { fetchYouTubeMusicMetadata } from "./youtube-music-metadata";
import { MessageType, sendMessage } from "@/lib/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/offscreen-messaging";
import { fetchAudioViaSabrStream, fetchVideoViaSabrStream } from "@/lib/sabr-download";
import { uint8ToBase64 } from "@/lib/utils";
import { DownloadType, ProgressType, StreamType } from "@/types";
import type { AdaptiveFormatItem, DownloadRequest, SabrConfig, VideoMetadata } from "@/types";

const activeBackgroundDownloads = new Map<string, AbortController>();
const TRANSFER_CHUNK_SIZE = 1024 * 1024;

function sendStreamChunksToOffscreen(
  videoId: string,
  streamType: string,
  data: Uint8Array,
  tabId: number
) {
  const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);

  for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
    const start = iChunk * TRANSFER_CHUNK_SIZE;
    const chunk = data.subarray(start, start + TRANSFER_CHUNK_SIZE);
    sendToOffscreen(OffscreenMessageType.ProcessStreamChunk, {
      videoId,
      streamType,
      iChunk,
      totalChunks,
      chunkBase64: uint8ToBase64(chunk),
      tabId
    });
  }
}

interface DownloadResult {
  videoData: Uint8Array | null;
  audioData: Uint8Array | null;
  additionalAudioTracks: Array<{
    data: Uint8Array | null; mimeType: string; label: string;
  }>;
}

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
}

function buildEffectiveSabrConfig(sabrConfig: SabrConfig, sabrUrl: string | undefined): SabrConfig {
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
      console.warn("[ytdl:bg] Extra audio track failed:", format.audioTrack?.displayName, trackError);
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

async function dispatchToOffscreen(
  request: DownloadRequest,
  result: DownloadResult,
  enrichedMetadata: VideoMetadata | null | undefined,
  tabId: number
) {
  await ensureProcessor();

  const resolvedVideoMimeType = request.videoFormat?.mimeType.split(";")[0] ?? "video/mp4";
  const resolvedAudioMimeType = request.audioFormat?.mimeType.split(";")[0] ?? "audio/mp4";
  if (result.videoData) {
    sendStreamChunksToOffscreen(request.videoId, StreamType.Video, result.videoData, tabId);
  }

  if (result.audioData) {
    sendStreamChunksToOffscreen(request.videoId, StreamType.Audio, result.audioData, tabId);
  }

  for (const [i, track] of result.additionalAudioTracks.entries()) {
    if (track.data) {
      sendStreamChunksToOffscreen(request.videoId, `audio-extra-${i}`, track.data, tabId);
    }
  }

  const audioTrackLabels = [
    request.primaryAudioLabel ?? "",
    ...result.additionalAudioTracks.map(track => track.label)
  ];

  sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
    type: request.type,
    videoId: request.videoId,
    filenameOutput: request.filenameOutput,
    videoMimeType: resolvedVideoMimeType,
    audioMimeType: resolvedAudioMimeType,
    audioTrackLabels,
    tabId,
    playlistId: request.playlistId,
    playlistTitle: request.playlistTitle,
    playlistTotalCount: request.playlistTotalCount,
    metadata: enrichedMetadata
  });
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

export async function startBackgroundDownload(request: DownloadRequest, tabId: number) {
  const { videoId, metadata } = request;
  cancelBackgroundDownload(videoId);
  const abortController = new AbortController();
  activeBackgroundDownloads.set(videoId, abortController);
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

      console.warn("[ytdl:bg] SABR failed, trying CDN:", sabrError);
    }

    if (!result?.audioData) {
      try {
        result = await downloadViaCdn(request, signal, videoId, tabId);
      } catch (cdnError) {
        if (signal.aborted) {
          return;
        }

        console.warn("[ytdl:bg] CDN fetch failed:", cdnError);
        return;
      }
    }

    if (!result?.audioData && !result?.videoData) {
      console.warn("[ytdl:bg] No download method succeeded for", videoId);
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId, progress: 0, progressType: ProgressType.Video, isRemoved: true
      }, tabId);
      return;
    }

    const enrichedMetadata = await enrichedMetadataPromise;
    await dispatchToOffscreen(request, result, enrichedMetadata, tabId);
  } catch (error) {
    if (signal.aborted) {
      return;
    }

    console.warn("[ytdl:bg] Background download failed:", error);
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId, progress: 0, progressType: ProgressType.Video, isRemoved: true
    }, tabId);
  } finally {
    activeBackgroundDownloads.delete(videoId);
  }
}
