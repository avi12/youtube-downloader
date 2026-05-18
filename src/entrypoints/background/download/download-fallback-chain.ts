import { downloadViaCdn } from "./cdn-downloader";
import { fetchWithProgress } from "./cdn-fetch";
import { fetchCdnUrlsViaWebClient } from "./cdn-url-resolver";
import { attemptSabrDownload } from "./sabr-attempt";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { getCompatibleFilename, splitFilenameAndExtension } from "@/lib/utils/filename";
import { DownloadType, ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export async function trySabr({ request, signal, tabId }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
}) {
  return attemptSabrDownload({
    request,
    signal,
    tabId
  }).catch(error => {
    if (signal.aborted) {
      throw error;
    }

    console.warn("[ytdl:bg] SABR failed, trying CDN:", error);
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: request.videoId,
      progress: 0,
      progressType: ProgressType.Video
    }, tabId);
    return null;
  });
}

export async function tryCdn({ request, signal, videoId, tabId, partialVideoData, partialAudioData }: {
  request: DownloadRequest;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
  partialVideoData?: Uint8Array;
  partialAudioData?: Uint8Array;
}) {
  return downloadViaCdn({
    request,
    signal,
    videoId,
    tabId,
    partialVideoData,
    partialAudioData
  }).catch(error => {
    if (signal.aborted) {
      throw error;
    }

    console.warn("[ytdl:bg] CDN failed, trying iframe fallback:", error);
    return null;
  });
}

export async function tryWebClientCdn({ request, signal, videoId, tabId }: {
  request: DownloadRequest;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
}) {
  const extraAudioItags = request.additionalAudioFormats?.map(format => format.itag) ?? [];
  const webUrls = await fetchCdnUrlsViaWebClient({
    videoId,
    videoItag: request.videoItag,
    audioItag: request.audioItag,
    extraAudioItags
  });
  if (!webUrls?.resolvedVideoUrl && !webUrls?.resolvedAudioUrl) {
    console.warn("[ytdl:bg] WEB_EMBEDDED_PLAYER returned no CDN URLs");
    return null;
  }

  console.warn("[ytdl:bg] WEB_EMBEDDED_PLAYER provided CDN URLs, retrying CDN download");
  return tryCdn({
    request: {
      ...request,
      resolvedVideoUrl: webUrls.resolvedVideoUrl,
      resolvedAudioUrl: webUrls.resolvedAudioUrl,
      resolvedExtraAudioUrls: webUrls.resolvedExtraUrls
    },
    signal,
    videoId,
    tabId
  });
}

export async function tryDirectUrlDownload({ request }: {
  request: DownloadRequest;
}) {
  const { type, resolvedAudioUrl, filenameOutput } = request;
  const isAudioOnly = type === DownloadType.Audio;
  if (!isAudioOnly || !resolvedAudioUrl) {
    return null;
  }

  try {
    const filename = getCompatibleFilename(filenameOutput);
    const downloadId = await browser.downloads.download({
      url: resolvedAudioUrl,
      filename
    });
    console.warn("[ytdl:bg] Direct URL download started, id:", downloadId);
    return downloadId;
  } catch (error) {
    console.warn("[ytdl:bg] Direct URL download failed:", error);
    return null;
  }
}

export async function tryProgressiveDownload({ request, signal }: {
  request: DownloadRequest;
  signal: AbortSignal;
}) {
  const { progressiveUrl, filenameOutput } = request;
  if (!progressiveUrl) {
    return null;
  }

  const { name } = splitFilenameAndExtension(filenameOutput);
  const filename = getCompatibleFilename(`${name}.mp4`);

  const YOUTUBE_ORIGIN = "https://www.youtube.com";
  let bytes: Uint8Array;
  try {
    bytes = await fetchWithProgress({
      url: progressiveUrl,
      signal,
      onBytesReceived() {},
      extraHeaders: {
        Origin: YOUTUBE_ORIGIN,
        Referer: `${YOUTUBE_ORIGIN}/`
      }
    });
  } catch (error) {
    if (signal.aborted) {
      throw error;
    }

    console.warn("[ytdl:bg] Progressive fetch failed:", error);
    return null;
  }

  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    const downloadId = await browser.downloads.download({
      url: blobUrl,
      filename
    });
    console.warn("[ytdl:bg] Progressive download started, id:", downloadId);
    return downloadId;
  } catch (error) {
    console.warn("[ytdl:bg] Progressive blob download failed:", error);
    return null;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
