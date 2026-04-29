import { capturedAlternateClientPoToken } from "./credentials";
import {
  getExtraAudioFormats,
  preResolveCdnUrls,
  resolveCredentialsWithRetry,
  selectFormats
} from "./download-helpers";
import { buildVideoMetadata, generatePoTokenIfNeeded, videoDataCache } from "./video-data";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { type DownloadRequest } from "@/types";

const activeDownloads = new Map<string, AbortController>();

export function cancelActiveDownload(videoId: string) {
  const controller = activeDownloads.get(videoId);
  if (controller) {
    controller.abort();
    activeDownloads.delete(videoId);
  }
}

export async function performDownload({
  type,
  videoId,
  videoItag,
  audioItag,
  filenameOutput,
  isIframeFallback,
  playlistId,
  playlistTitle,
  playlistTotalCount
}: Pick<DownloadRequest, "type" | "videoId" | "videoItag" | "audioItag" | "filenameOutput" | "isIframeFallback" | "playlistId" | "playlistTitle" | "playlistTotalCount">) {
  if (isIframeFallback && self === top) {
    return;
  }

  cancelActiveDownload(videoId);
  const abortController = new AbortController();
  activeDownloads.set(videoId, abortController);

  const tag = `[ytdl:perform ${videoId}]`;
  console.log(`${tag} start`);
  try {
    const cachedVideoData = videoDataCache.get(videoId);
    if (!cachedVideoData) {
      console.error("[ytdl] No video data cached for", videoId);
      return;
    }

    const { videoFormat, audioFormat } = selectFormats({
      videoData: cachedVideoData,
      type,
      videoItag,
      audioItag
    });
    const extraAudioFormats = getExtraAudioFormats({
      audioFormats: cachedVideoData.audioFormats,
      selectedTrackId: audioFormat?.audioTrack?.id
    });
    console.log(`${tag} formats picked, generating po token`);
    await generatePoTokenIfNeeded(cachedVideoData);
    console.log(`${tag} po token done, resolving credentials`);
    const credentials = await resolveCredentialsWithRetry();
    console.log(`${tag} credentials done, pre-resolving cdn urls`);

    const [[resolvedVideoUrl, resolvedAudioUrl, ...resolvedExtraAudioUrls], metadata] =
      await Promise.all([
        preResolveCdnUrls({
          type,
          videoFormat,
          audioFormat,
          extraAudioFormats
        }),
        buildVideoMetadata(videoId)
      ]);
    console.log(`${tag} cdn pre-resolve + metadata done, sending StartBackgroundDownload`);

    const videoDurationMs = parseInt(videoFormat?.approxDurationMs ?? audioFormat?.approxDurationMs ?? "0", 10);
    const videoDurationSec = Math.ceil(videoDurationMs / 1000);

    const enrichedRequest: DownloadRequest = {
      type,
      videoId,
      videoItag,
      audioItag,
      filenameOutput,
      isIframeFallback,
      sabrConfig: cachedVideoData.sabrConfig,
      poToken: credentials.poToken,
      alternateClientPoToken: capturedAlternateClientPoToken,
      sabrUrl: credentials.sabrUrl,
      videoFormat,
      audioFormat,
      additionalAudioFormats: extraAudioFormats,
      primaryAudioLabel: audioFormat?.audioTrack?.displayName ?? "",
      metadata,
      resolvedVideoUrl,
      resolvedAudioUrl,
      resolvedExtraAudioUrls,
      playlistId,
      playlistTitle,
      playlistTotalCount,
      captionTracks: cachedVideoData.captionTracks,
      videoDurationSec
    };

    void crossWorldMessenger.sendMessage(CrossWorldMessage.StartBackgroundDownload, enrichedRequest);
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    throw error;
  } finally {
    activeDownloads.delete(videoId);
  }
}
