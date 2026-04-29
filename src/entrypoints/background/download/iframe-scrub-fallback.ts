import { startIframeScrubSession } from "../handlers/iframe-scrub-orchestrator";
import { broadcastDebugLogToTab } from "@/lib/messaging/debug-log";
import type { DownloadRequest } from "@/types";

const FIREFOX_IFRAME_SCRUB_FALLBACK_MIN_DURATION_SEC = 240;

export async function tryIframeScrubFallback({ request, cdnRequest, videoId, tabId }: {
  request: DownloadRequest;
  cdnRequest: DownloadRequest;
  videoId: string;
  tabId: number;
}) {
  const durationSec = request.videoDurationSec ?? 0;
  if (!import.meta.env.FIREFOX || durationSec < FIREFOX_IFRAME_SCRUB_FALLBACK_MIN_DURATION_SEC) {
    return false;
  }

  broadcastDebugLogToTab(`[ytdl:bg] CDN unavailable; using iframe-scrub for ${videoId} (${durationSec}s)`, tabId);
  await startIframeScrubSession({
    videoId,
    durationSec,
    type: request.type,
    filenameOutput: request.filenameOutput,
    videoMimeType: request.videoFormat?.mimeType?.split(";")[0] || "video/mp4",
    audioMimeType: request.audioFormat?.mimeType?.split(";")[0] || "audio/mp4",
    audioLabel: request.primaryAudioLabel ?? "",
    metadata: request.metadata,
    playlistId: request.playlistId,
    playlistTitle: request.playlistTitle,
    playlistTotalCount: request.playlistTotalCount,
    additionalAudioFormats: cdnRequest.additionalAudioFormats,
    resolvedExtraAudioUrls: cdnRequest.resolvedExtraAudioUrls,
    captionTracks: cdnRequest.captionTracks,
    tabId
  });
  return true;
}
