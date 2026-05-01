import type { DownloadResult } from "./background-downloader";
import { downloadViaCdn } from "./cdn-downloader";
import { tryIframeScrubFallback } from "./iframe-scrub-fallback";
import { attemptSabrDownload } from "./sabr-stall-guard";
import { broadcastDebugLogToTab } from "@/lib/messaging/debug-log";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export async function resolveDownloadResult({ request, cdnRequest, signal, videoId, tabId }: {
  request: DownloadRequest;
  cdnRequest: DownloadRequest;
  signal: AbortSignal;
  videoId: string;
  tabId: number;
}) {
  const isAnyCdnUrlPresent = Boolean(cdnRequest.resolvedVideoUrl || cdnRequest.resolvedAudioUrl);
  broadcastDebugLogToTab(
    `[ytdl:bg] CDN-first check: haveUrls=${isAnyCdnUrlPresent} video=${Boolean(cdnRequest.resolvedVideoUrl)} audio=${Boolean(cdnRequest.resolvedAudioUrl)}`,
    tabId
  );

  let result: DownloadResult | null = null;
  if (isAnyCdnUrlPresent) {
    result = await downloadViaCdn({
      request: cdnRequest,
      signal,
      videoId,
      tabId
    }).catch(error => {
      if (signal.aborted) {
        throw error;
      }

      console.warn("[ytdl:bg] CDN-first failed:", error);
      broadcastDebugLogToTab(`[ytdl:bg] CDN-first threw: ${String(error)}`, tabId);
      return null;
    });
    broadcastDebugLogToTab(
      `[ytdl:bg] CDN-first done: video=${result?.videoData?.byteLength ?? 0}B audio=${result?.audioData?.byteLength ?? 0}B`,
      tabId
    );
  }

  if (!result?.audioData && !result?.videoData) {
    const isFallbackUsed = await tryIframeScrubFallback({
      request,
      cdnRequest,
      videoId,
      tabId
    });
    if (isFallbackUsed) {
      return "iframe-scrub";
    }
  }

  if (!result?.audioData) {
    result = await attemptSabrDownload({
      request,
      signal,
      tabId
    }).catch(sabrError => {
      if (signal.aborted) {
        throw sabrError;
      }

      console.warn("[ytdl:bg] direct SABR failed:", sabrError);
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress: 0,
        progressType: ProgressType.Video
      }, tabId);
      return null;
    });
  }

  return result;
}
