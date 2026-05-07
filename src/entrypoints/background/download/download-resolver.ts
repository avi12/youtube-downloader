import type { DownloadResult } from "./background-downloader";
import { downloadViaCdn } from "./cdn-downloader";
import { primeViaSabrOffscreen } from "./offscreen-sabr-primer";
import { attemptSabrDownload } from "./sabr-stall-guard";
import { broadcastDebugLogToTab } from "@/lib/messaging/debug-log";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { buildSapiSidHash } from "@/lib/youtube/alternate-client-specs";
import { hasFreshCapturedSabrDataForTab } from "@/lib/youtube/sabr/request-capture";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export const DownloadResolution = {
  ProgressiveSabr: "progressive-sabr"
} as const;

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

  let primerResult: {
    url: string;
    bodyBase64: string;
  } | null = null;
  if (!result?.audioData?.byteLength) {
    broadcastDebugLogToTab(`[ytdl:bg] attempting direct SABR hasSabrConfig=${Boolean(request.sabrConfig)} hasAudioFmt=${Boolean(request.audioFormat)} configUrl=${request.sabrConfig?.serverAbrStreamingUrl?.slice(0, 80)} sabrUrl=${request.sabrUrl?.slice(0, 80)} configLen=${request.sabrConfig?.videoPlaybackUstreamerConfig?.length}`, tabId);

    if (!hasFreshCapturedSabrDataForTab(tabId)) {
      broadcastDebugLogToTab(`[ytdl:bg] no tab SABR capture, priming via offscreen iframe for ${videoId}`, tabId);
      primerResult = await primeViaSabrOffscreen(videoId);
      broadcastDebugLogToTab(`[ytdl:bg] offscreen SABR primer result: ${Boolean(primerResult)}`, tabId);
    }

    result = await attemptSabrDownload({
      request,
      signal,
      tabId
    }).catch(sabrError => {
      if (signal.aborted) {
        throw sabrError;
      }

      broadcastDebugLogToTab(`[ytdl:bg] direct SABR failed: ${String(sabrError)}`, tabId);
      console.warn("[ytdl:bg] direct SABR failed:", sabrError);
      void sendMessage(MessageType.UpdateDownloadProgress, {
        videoId,
        progress: 0,
        progressType: ProgressType.Video
      }, tabId);
      return null;
    });
  }

  if (!result?.audioData?.byteLength) {
    broadcastDebugLogToTab(`[ytdl:bg] SABR stalled, falling back to RunCdnFetchInTab for ${videoId}`, tabId);

    const [progressiveBase, authorization] = await Promise.all([
      primerResult?.url && request.sabrConfig
        ? Promise.resolve({
          ...cdnRequest,
          sabrConfig: {
            ...request.sabrConfig,
            serverAbrStreamingUrl: primerResult.url
          }
        })
        : Promise.resolve(cdnRequest),
      buildSapiSidHash()
    ]);
    const progressiveRequest: DownloadRequest = {
      ...progressiveBase,
      ...(authorization && { authorization }),
      ...(primerResult && {
        primerBodyBase64: primerResult.bodyBase64
      })
    };
    void sendMessage(MessageType.RunCdnFetchInTab, progressiveRequest, tabId);
    return DownloadResolution.ProgressiveSabr;
  }

  return result;
}
