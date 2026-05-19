import { resolveOrderedCaptionTracks } from "./caption-fetch";
import {
  getExtraAudioFormats,
  preResolveCdnUrls,
  resolveCredentialsWithRetry,
  selectFormats
} from "./download-formats";
import { buildEnrichedRequest, fetchCaptionWebVttData } from "./download-request-builder";
import { generatePoTokenIfNeeded, videoDataCache } from "./video-data";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { getCompatibleFilename, splitFilenameAndExtension } from "@/lib/utils/filename";
import { isVideoDataExpired } from "@/lib/youtube/video-helpers";
import type { DownloadRequest } from "@/types";

async function tryProgressiveInPage({ url, filenameOutput, videoId }: {
  url: string;
  filenameOutput: string;
  videoId: string;
}) {
  try {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) {
      console.warn("[ytdl:main] Progressive fetch status:", response.status);
      return false;
    }

    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    const { name } = splitFilenameAndExtension(filenameOutput);
    await crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadBlobUrl, {
      blobUrl,
      filename: getCompatibleFilename(`${name}.mp4`),
      videoId
    });
    return true;
  } catch (error) {
    console.warn("[ytdl:main] Progressive fetch failed:", error);
    return false;
  }
}

export type DownloadParams = Pick<DownloadRequest,
  "type" | "videoId" | "videoItag" | "audioItag" | "audioTrackId" |
  "selectedCaptionVssId" | "filenameOutput" | "isIframeFallback" |
  "playlistId" | "playlistTitle" | "playlistTotalCount"
>;

export async function resolveAndDispatch({ params, abortSignal }: {
  params: DownloadParams;
  abortSignal: AbortSignal;
}) {
  const {
    type, videoId, videoItag, audioItag, audioTrackId, selectedCaptionVssId
  } = params;

  const cachedVideoData = videoDataCache.get(videoId);
  if (!cachedVideoData) {
    console.error("[ytdl] No video data cached for", videoId);
    return;
  }

  const isExpiredOnTopFrame = self === top && isVideoDataExpired(cachedVideoData);
  if (isExpiredOnTopFrame) {
    void crossWorldMessenger.sendMessage(
      CrossWorldMessage.DownloadViaIframe,
      {
        ...params,
        isIframeFallback: true
      }
    );
    return;
  }

  const options = CONTENT_OPTIONS;
  const orderedCaptionTracks = resolveOrderedCaptionTracks(
    cachedVideoData.captionTracks, selectedCaptionVssId, options.downloadExtras
  );
  const captionVttDataPromise = fetchCaptionWebVttData({
    captionTracks: orderedCaptionTracks,
    videoId
  });
  const { videoFormat, audioFormat } = selectFormats({
    videoData: cachedVideoData,
    type,
    videoItag,
    audioItag,
    audioTrackId
  });
  const extraAudioFormats = options.downloadExtras
    ? getExtraAudioFormats({
      audioFormats: cachedVideoData.audioFormats,
      selectedTrackId: audioFormat?.audioTrack?.id,
      selectedFormat: audioFormat,
      includeAutoDubbing: options.includeAutoDubbing
    })
    : [];

  await generatePoTokenIfNeeded(cachedVideoData);
  const credentials = await resolveCredentialsWithRetry();
  const [resolvedVideoUrl, resolvedAudioUrl, ...resolvedExtraAudioUrls] =
    await preResolveCdnUrls({
      type,
      videoFormat,
      audioFormat,
      extraAudioFormats
    });
  if (abortSignal.aborted) {
    return;
  }

  const sabrUrl = credentials.sabrUrl ?? null;

  // No adaptive CDN URLs but a progressive URL available: fetch directly in this
  // main-world context where YouTube cookies flow to googlevideo.com without
  // third-party restrictions. Works from the top-frame playlist/watch page and
  // from the iframe fallback context.
  const canTryProgressiveInPage = !resolvedVideoUrl
    && !resolvedAudioUrl
    && !!cachedVideoData.progressiveUrl;
  if (canTryProgressiveInPage) {
    const didStart = await tryProgressiveInPage({
      url: cachedVideoData.progressiveUrl!,
      filenameOutput: params.filenameOutput,
      videoId
    });
    if (didStart) {
      return;
    }
  }

  const enrichedRequest = await buildEnrichedRequest({
    params,
    resolved: {
      sabrConfig: cachedVideoData.sabrConfig,
      poToken: credentials.poToken,
      sabrUrl,
      videoFormat,
      audioFormat,
      extraAudioFormats,
      orderedCaptionTracks,
      captionVttDataPromise,
      resolvedVideoUrl,
      resolvedAudioUrl,
      resolvedExtraAudioUrls,
      progressiveUrl: cachedVideoData.progressiveUrl
    }
  });
  if (abortSignal.aborted) {
    return;
  }

  void crossWorldMessenger.sendMessage(CrossWorldMessage.StartBackgroundDownload, {
    requestJson: JSON.stringify(enrichedRequest)
  });
}
