import { ensureProcessor } from "../handlers/processor";
import { reportDownloadFailed } from "./download-failure-reporter";
import { enrichMetadataFromYouTubeMusic } from "./metadata-enrichment";
import {
  clearInterruptedDownload,
  dropPendingRetry,
  queueNetworkRetry,
  registerOnlineRetryListener
} from "./network-retry";
import { clearIframeAutoRetry } from "./sabr-attempt";
import { buildEffectiveSabrConfig } from "./sabr-utils";
import { buildSubtitleTracks } from "./stream-chunk-transfer";
import { notifyPlaylistBundleFailure } from "@/lib/download-pipeline/playlist-bundle";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { stripMimeParams } from "@/lib/utils/containers";
import { DownloadType } from "@/types";
import type { DownloadRequest } from "@/types";

export type { DownloadResult } from "./download-result-types";
export { dropPendingRetry, reportDownloadFailed };

registerOnlineRetryListener(startBackgroundDownload);

export function cancelBackgroundDownload(_videoId: string) {
  // Downloads run in offscreen worker iframes; cancellation goes through CancelProcessing message.
}

export async function startBackgroundDownload({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  const { videoId, metadata } = request;
  if (!request.isIframeFallback) {
    clearIframeAutoRetry(videoId);
  }

  try {
    const enrichedMetadataPromise = enrichMetadataFromYouTubeMusic(metadata);
    const isAudioOnly = request.type === DownloadType.Audio;
    const hasSabrConfig = !!(request.sabrConfig && request.audioFormat);
    if (isAudioOnly && hasSabrConfig) {
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

    reportDownloadFailed({
      videoId,
      tabId
    });
  }
}
