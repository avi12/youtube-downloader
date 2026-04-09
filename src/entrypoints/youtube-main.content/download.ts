import { capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./credentials";
import { resolveFormatUrl } from "./stream-fetch";
import { buildVideoMetadata, videoDataCache } from "./video-data";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging";
import { sabrCredentials } from "@/lib/synced-stores.svelte";
import { type AdaptiveFormatItem, type DownloadRequest, DownloadType } from "@/types";

const activeDownloads = new Map<string, AbortController>();

export function cancelActiveDownload(videoId: string) {
  const controller = activeDownloads.get(videoId);
  if (controller) {
    controller.abort();
    activeDownloads.delete(videoId);
  }
}

function getExtraAudioFormats(
  audioFormats: AdaptiveFormatItem[],
  selectedTrackId: string | undefined
) {
  if (!selectedTrackId) {
    return [];
  }

  const seenTrackIds = new Set([selectedTrackId]);
  return audioFormats.filter(format => {
    const trackId = format.audioTrack?.id;
    if (!trackId || seenTrackIds.has(trackId)) {
      return false;
    }

    seenTrackIds.add(trackId);
    return true;
  });
}

function dispatchStreamError(videoId: string, error: string) {
  void crossWorldMessenger.sendMessage(CrossWorldMessage.StreamError, {
    videoId,
    error
  });
}

export async function performDownload({
  type,
  videoId,
  videoItag,
  audioItag,
  filenameOutput,
  isIframeFallback
}: Pick<DownloadRequest, "type" | "videoId" | "videoItag" | "audioItag" | "filenameOutput" | "isIframeFallback">) {
  if (isIframeFallback && self === top) {
    return;
  }

  cancelActiveDownload(videoId);
  const abortController = new AbortController();
  activeDownloads.set(videoId, abortController);

  try {
    const cachedVideoData = videoDataCache.get(videoId);
    if (!cachedVideoData) {
      console.error("[ytdl] No video data cached for", videoId);
      return;
    }

    const videoFormat = type !== DownloadType.Audio
      ? (cachedVideoData.videoFormats.find(format => format.itag === videoItag) ?? cachedVideoData.videoFormats[0])
      : null;
    const audioFormat = type !== DownloadType.Video
      ? (cachedVideoData.audioFormats.find(format => format.itag === audioItag) ?? cachedVideoData.audioFormats[0])
      : null;

    const audioLabel = audioFormat?.audioTrack?.displayName ?? "";
    const extraAudioFormats = getExtraAudioFormats(cachedVideoData.audioFormats, audioFormat?.audioTrack?.id);

    const creds = sabrCredentials.value;
    let currentPoToken = capturedPoToken;
    let currentSabrUrl = capturedSabrUrl;
    if (creds?.url) {
      currentSabrUrl = creds.url;
    }

    if (!currentPoToken && creds?.poToken) {
      currentPoToken = creds.poToken;
    }

    if (!currentPoToken || !currentSabrUrl) {
      const elCredentials = document.getElementById("ytdl-sabr-credentials");
      if (elCredentials?.dataset.url) {
        currentSabrUrl = elCredentials.dataset.url;
      }

      if (!currentPoToken && elCredentials?.dataset.poToken) {
        currentPoToken = elCredentials.dataset.poToken;
      }
    }

    if (currentPoToken !== capturedPoToken || currentSabrUrl !== capturedSabrUrl) {
      setPoTokenCredentials(currentPoToken, currentSabrUrl);
    }

    // Pre-resolve CDN URLs so background SW can use them as fallback
    const [resolvedVideoUrl, resolvedAudioUrl, ...resolvedExtraAudioUrls] = await Promise.all([
      type !== DownloadType.Audio ? resolveFormatUrl(videoFormat ?? null) : Promise.resolve(null),
      type !== DownloadType.Video ? resolveFormatUrl(audioFormat ?? null) : Promise.resolve(null),
      ...extraAudioFormats.map(format => resolveFormatUrl(format))
    ]);

    const metadata = buildVideoMetadata(videoId);

    const enrichedRequest: DownloadRequest = {
      type,
      videoId,
      videoItag,
      audioItag,
      filenameOutput,
      isIframeFallback,
      sabrConfig: cachedVideoData.sabrConfig,
      poToken: currentPoToken,
      sabrUrl: currentSabrUrl,
      videoFormat,
      audioFormat,
      additionalAudioFormats: extraAudioFormats,
      primaryAudioLabel: audioLabel,
      metadata,
      resolvedVideoUrl,
      resolvedAudioUrl,
      resolvedExtraAudioUrls,
      playlistId: undefined,
      playlistTitle: undefined,
      playlistTotalCount: undefined
    };

    try {
      await sendMessage(MessageType.StartBackgroundDownload, enrichedRequest);
    } catch (error) {
      dispatchStreamError(videoId, "Failed to start background download");
      throw error;
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    throw error;
  } finally {
    activeDownloads.delete(videoId);
  }
}
