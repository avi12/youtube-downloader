import { ensureProcessor } from "../handlers/processor";
import { removeFromPopupList } from "../queue/popup-list";
import { signalVideoComplete } from "../queue/sequential-queue";
import { reportDownloadFailed } from "./download-failure-reporter";
import { trySabr, tryCdn, tryDirectUrlDownload } from "./download-fallback-chain";
import type { DownloadResult } from "./download-result-types";
import { enrichMetadataFromYouTubeMusic } from "./metadata-enrichment";
import {
  clearInterruptedDownload,
  dropPendingRetry,
  queueNetworkRetry,
  registerOnlineRetryListener
} from "./network-retry";
import { clearIframeAutoRetry, handleIframeFallback } from "./sabr-attempt";
import { buildEffectiveSabrConfig } from "./sabr-utils";
import { buildSubtitleTracks } from "./stream-chunk-transfer";
import { dispatchToOffscreen } from "./stream-dispatch";
import { notifyPlaylistBundleFailure } from "@/lib/download-pipeline/playlist-bundle";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { stripMimeParams } from "@/lib/utils/containers";
import { DownloadType, ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

export type { DownloadResult } from "./download-result-types";
export { dropPendingRetry, reportDownloadFailed };

const activeBackgroundDownloads = new Map<string, AbortController>();

registerOnlineRetryListener(startBackgroundDownload);

export function cancelBackgroundDownload(videoId: string) {
  const controller = activeBackgroundDownloads.get(videoId);
  if (!controller) {
    return;
  }

  controller.abort();
  activeBackgroundDownloads.delete(videoId);
}

export async function startBackgroundDownload({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  const { videoId, metadata } = request;
  cancelBackgroundDownload(videoId);

  if (!request.isIframeFallback) {
    clearIframeAutoRetry(videoId);
  }

  const abortController = new AbortController();
  activeBackgroundDownloads.set(videoId, abortController);
  const { signal } = abortController;

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
          enrichedMetadata: await enrichedMetadataPromise
        }
      });
      await clearInterruptedDownload(videoId);
      return;
    }

    if (isAudioOnly) {
      await ensureProcessor();
    }

    let result: DownloadResult | null = await trySabr({
      request,
      signal,
      tabId
    });
    if (signal.aborted) {
      return;
    }

    const hasNoAudioData = !(result?.audioData?.byteLength) && !result?.streamedToOffscreen;
    const needsCdn = hasNoAudioData || result?.isPartialVideo || result?.isPartialAudio;
    const { resolvedVideoUrl, resolvedAudioUrl } = request;
    const hasCdnUrls = !!(resolvedVideoUrl || resolvedAudioUrl);
    const shouldFallToCdn = needsCdn && hasCdnUrls;
    if (shouldFallToCdn) {
      // Never resume partial video data from SABR in non-streaming CDN mode.
      // For large 4K files, combining SABR partial bytes + CDN remainder in RAM
      // causes OOM. CDN streaming mode (chunks → offscreen → OPFS) avoids this.
      const partialAudioData = result?.isPartialAudio ? (result.audioData ?? undefined) : undefined;
      const willStream = !isAudioOnly && !partialAudioData;
      if (willStream) {
        await ensureProcessor();
      }

      result = await tryCdn({
        request,
        signal,
        videoId,
        tabId,
        partialAudioData
      });
    }

    if (signal.aborted) {
      return;
    }

    const hasNoData = !result
      || (!(result.videoData?.byteLength) && !(result.audioData?.byteLength) && !result.streamedToOffscreen);
    if (hasNoData) {
      const directDownloadId = await tryDirectUrlDownload({ request });
      if (directDownloadId !== null) {
        clearIframeAutoRetry(videoId);

        if (tabId >= 0) {
          await sendMessage(MessageType.UpdateDownloadProgress, {
            videoId,
            progress: 0,
            progressType: ProgressType.Video,
            isRemoved: true
          }, tabId);
        }

        await removeFromPopupList(videoId);
        signalVideoComplete(videoId);
        return;
      }

      await handleIframeFallback({
        request,
        tabId,
        videoId,
        reportDownloadFailed
      });
      return;
    }

    clearIframeAutoRetry(videoId);
    await dispatchToOffscreen({
      request,
      result: result!,
      enrichedMetadata: await enrichedMetadataPromise,
      tabId,
      skipChunkTransfer: result!.streamedToOffscreen
    });
    await clearInterruptedDownload(videoId);
  } catch (error) {
    if (signal.aborted) {
      return;
    }

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
  } finally {
    activeBackgroundDownloads.delete(videoId);
  }
}
