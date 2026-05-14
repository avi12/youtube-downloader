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
import { isVideoDataExpired } from "@/lib/youtube/video-helpers";
import type { DownloadRequest } from "@/types";

export type DownloadParams = Pick<DownloadRequest,
  "type" | "videoId" | "videoItag" | "audioItag" | "audioTrackId" |
  "selectedCaptionVssId" | "filenameOutput" | "isIframeFallback" |
  "playlistId" | "playlistTitle" | "playlistTotalCount"
>;

export async function executeDownload(params: DownloadParams, abortSignal: AbortSignal) {
  const {
    type, videoId, videoItag, audioItag, audioTrackId, selectedCaptionVssId
  } = params;

  const cachedVideoData = videoDataCache.get(videoId);
  if (!cachedVideoData) {
    console.error("[ytdl] No video data cached for", videoId);
    return;
  }

  if (self === top && isVideoDataExpired(cachedVideoData)) {
    void crossWorldMessenger.sendMessage(
      CrossWorldMessage.DownloadViaIframe,
      {
        ...params,
        isIframeFallback: true
      }
    );
    return;
  }

  const options = CONTENT_OPTIONS.value;
  const orderedCaptionTracks = resolveOrderedCaptionTracks(
    cachedVideoData.captionTracks, selectedCaptionVssId, options.downloadExtras
  );
  const captionVttDataPromise = fetchCaptionWebVttData(orderedCaptionTracks, videoId);
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
      selectedFormat: audioFormat
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

  const enrichedRequest = await buildEnrichedRequest(params, {
    sabrConfig: cachedVideoData.sabrConfig,
    poToken: credentials.poToken,
    sabrUrl: credentials.sabrUrl,
    videoFormat,
    audioFormat,
    extraAudioFormats,
    orderedCaptionTracks,
    captionVttDataPromise,
    resolvedVideoUrl,
    resolvedAudioUrl,
    resolvedExtraAudioUrls
  });

  void crossWorldMessenger.sendMessage(CrossWorldMessage.StartBackgroundDownload, {
    requestJson: JSON.stringify(enrichedRequest)
  });
}
