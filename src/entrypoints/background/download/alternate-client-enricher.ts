import { broadcastDebugLogToTab } from "@/lib/messaging/debug-log";
import {
  fetchAlternateClientFormats,
  findExtraAudioFormatUrl,
  findFormatUrlByItag
} from "@/lib/youtube/alternate-client";
import type { DownloadRequest } from "@/types";

export async function enrichWithAlternateClientUrls(
  request: DownloadRequest,
  tabId?: number
) {
  const isVideoUrlRequired = !request.resolvedVideoUrl;
  const isAudioUrlRequired = !request.resolvedAudioUrl;
  const extraFormats = request.additionalAudioFormats ?? [];
  const existingExtraUrls = request.resolvedExtraAudioUrls ?? [];
  const isExtraAudioUrlsRequired = extraFormats.length > 0 &&
    extraFormats.some((_, i) => !existingExtraUrls[i]);
  if (!isVideoUrlRequired && !isAudioUrlRequired && !isExtraAudioUrlsRequired) {
    return request;
  }

  try {
    const formats = await fetchAlternateClientFormats({
      videoId: request.videoId,
      poToken: request.alternateClientPoToken || request.poToken || ""
    });
    const enriched: DownloadRequest = { ...request };
    if (isVideoUrlRequired) {
      enriched.resolvedVideoUrl = findFormatUrlByItag(formats, request.videoItag);
    }

    if (isAudioUrlRequired) {
      enriched.resolvedAudioUrl = findFormatUrlByItag(formats, request.audioItag);
    }

    if (isExtraAudioUrlsRequired) {
      enriched.resolvedExtraAudioUrls = extraFormats.map((format, i) =>
        existingExtraUrls[i] ?? findExtraAudioFormatUrl(formats, format.itag, format.audioTrack?.id));
    }

    if (typeof tabId === "number") {
      const availableItags = formats.map(format => format.itag).join(",");
      broadcastDebugLogToTab(
        `[ytdl:bg] alternate-client returned ${formats.length} formats (itags=${availableItags}); video itag ${request.videoItag} url=${Boolean(enriched.resolvedVideoUrl)}, audio itag ${request.audioItag} url=${Boolean(enriched.resolvedAudioUrl)}, extra=${enriched.resolvedExtraAudioUrls?.filter(Boolean).length ?? 0}/${extraFormats.length}`,
        tabId
      );
    }

    return enriched;
  } catch (error) {
    console.warn("[ytdl:bg] Alternate-client fallback failed:", error);

    if (typeof tabId === "number") {
      broadcastDebugLogToTab(`[ytdl:bg] alternate-client threw: ${String(error)}`, tabId);
    }

    return request;
  }
}
