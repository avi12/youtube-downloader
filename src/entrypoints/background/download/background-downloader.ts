import { ensureProcessor } from "../handlers/processor";
import { reportDownloadFailed } from "./download-failure-reporter";
import { runFirefoxDirectDownload } from "./firefox-direct-download";
import { enrichMetadataFromYouTubeMusic } from "./metadata-enrichment";
import {
  clearInterruptedDownload,
  dropPendingRetry,
  queueNetworkRetry,
  registerOnlineRetryListener
} from "./network-retry";
import { clearIframeAutoRetry } from "./sabr-attempt";
import { buildEffectiveSabrConfig } from "./sabr-utils";
import { buildSubtitleTracks } from "./subtitle-track-builder";
import { notifyPlaylistBundleFailure } from "@/lib/download-pipeline/playlist-bundle";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { stripMimeParams } from "@/lib/utils/containers";
import { DownloadType } from "@/types";
import type { DownloadRequest } from "@/types";

// Chrome MV3 has `chrome.offscreen`. Firefox MV3 does not, so this acts as a
// reliable browser discriminator throughout the download pipeline.
function isFirefoxRuntime() {
  return typeof browser.offscreen === "undefined";
}

export type { DownloadResult } from "./download-result-types";
export { dropPendingRetry, reportDownloadFailed };

registerOnlineRetryListener(startBackgroundDownload);

export function cancelBackgroundDownload(_videoId: string) {}

type StartBackgroundDownloadParams = {
  request: DownloadRequest;
  tabId: number;
};
export async function startBackgroundDownload({ request, tabId }: StartBackgroundDownloadParams) {
  const { videoId, metadata } = request;
  if (!request.isIframeFallback) {
    clearIframeAutoRetry(videoId);
  }

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);
    const isAudioOnly = request.type === DownloadType.Audio;
    const isSabrConfigPresent = !!(request.sabrConfig && request.audioFormat);
    const isAudioOnlyWithSabr = isAudioOnly && isSabrConfigPresent;
    if (isAudioOnlyWithSabr) {
      await ensureProcessor();
      const effectiveSabrConfig = buildEffectiveSabrConfig({
        sabrConfig: request.sabrConfig!,
        sabrUrl: request.sabrUrl
      });
      const subtitleTracks = buildSubtitleTracks({
        captionTracks: request.captionTracks,
        captionVttData: request.captionVttData ?? []
      });
      sendToOffscreen({
        type: OffscreenMessageType.DownloadAudioViaSabr,
        data: {
          videoId,
          tabId,
          sabrConfig: effectiveSabrConfig,
          audioFormat: request.audioFormat!,
          poToken: request.poToken ?? "",
          type: request.type,
          filenameOutput: request.filenameOutput,
          audioMimeType: stripMimeParams(request.audioFormat!.mimeType),
          audioTrackLabels: [request.primaryAudioLabel ?? ""],
          audioTrackLanguages: [request.primaryAudioLanguageCode ?? ""],
          subtitleTracks,
          playlistId: request.playlistId,
          playlistTitle: request.playlistTitle,
          playlistTotalCount: request.playlistTotalCount,
          enrichedMetadata: (await enrichedMetadataPromise) ?? null
        }
      });
      await clearInterruptedDownload(videoId);
      return;
    }

    await ensureProcessor();

    // Firefox: bypass SABR entirely via the ANDROID_VR path (see `runFirefoxDirectDownload`).
    if (isFirefoxRuntime()) {
      await runFirefoxDirectDownload({
        request,
        tabId,
        enrichedMetadata: (await enrichedMetadataPromise) ?? null
      });
      await clearInterruptedDownload(videoId);
      return;
    }

    // Chrome: hand off to the offscreen worker iframe, which tries SABR first
    // and falls back to direct CDN if SABR stalls/fails. See `download-worker/main.ts`.
    sendToOffscreen({
      type: OffscreenMessageType.StartDownloadInIframe,
      data: {
        request,
        tabId,
        enrichedMetadata: (await enrichedMetadataPromise) ?? null
      }
    });
  } catch (error) {
    const isOffline = !navigator.onLine;
    if (isOffline) {
      await queueNetworkRetry({
        request,
        tabId
      });
      return;
    }

    console.warn("[ytdl:bg] Background download failed:", error);

    if (request.playlistId) {
      notifyPlaylistBundleFailure(request.playlistId);
    }

    void reportDownloadFailed({
      videoId,
      tabId
    });
  }
}
