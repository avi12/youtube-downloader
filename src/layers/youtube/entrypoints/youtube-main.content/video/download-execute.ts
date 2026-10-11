import { preResolveCdnUrls, resolveCredentialsWithRetry } from "./download-formats";
import { buildEnrichedRequest, fetchCaptionWebVttData } from "./download-request-builder";
import { generatePoTokenIfNeeded, videoDataCache } from "./video-data";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import { getCompatibleFilename, splitFilenameAndExtension } from "@/lib/utils/filename";
import { resolveDownloadPlan } from "@/lib/youtube/download-plan";
import { CAPTION_ESTIMATED_BYTES } from "@/lib/youtube/download-progress";
import { isVideoDataExpired } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem, DownloadRequest, Prettify, VideoData } from "@/types";

function readContentLength(format: AdaptiveFormatItem | null) {
  if (!format?.contentLength) {
    return 0;
  }

  const bytes = Number(format.contentLength);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

const PROGRESSIVE_DOWNLOAD_EXTENSION = "mp4";

type TryProgressiveInPageParams = Prettify<{
  url: string;
  filenameOutput: string;
  videoId: string;
}>;
async function tryProgressiveInPage({ url, filenameOutput, videoId }: TryProgressiveInPageParams) {
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
      filename: getCompatibleFilename(`${name}.${PROGRESSIVE_DOWNLOAD_EXTENSION}`),
      videoId
    });
    return true;
  } catch (error) {
    console.warn("[ytdl:main] Progressive fetch failed:", error);
    return false;
  }
}

export type DownloadParams = Prettify<Pick<DownloadRequest,
  "type" | "videoId" | "videoItag" | "audioItag" | "audioTrackId" |
  "selectedCaptionVssId" | "filenameOutput" | "isIframeFallback" |
  "downloadExtras" | "downloadExtraCaptions" | "includeAutoDubbing" |
  "playlistId" | "playlistTitle" | "playlistTotalCount" |
  "originTabId"
>>;

type AnnounceDownloadParams = Prettify<{
  params: DownloadParams;
  videoData: VideoData;
}>;
async function announceDownload({ params, videoData }: AnnounceDownloadParams) {
  const { videoDetails } = videoData.playerResponse;
  await crossWorldMessenger.sendMessage(CrossWorldMessage.AnnounceDownload, {
    videoId: params.videoId,
    type: params.type,
    filenameOutput: params.filenameOutput,
    title: videoData.title,
    channel: videoDetails?.author,
    thumbnailUrl: videoDetails?.thumbnail?.thumbnails?.at(-1)?.url,
    lengthSeconds: Number(videoDetails?.lengthSeconds) || undefined
  });
}

type ResolveAndDispatchParams = Prettify<{
  params: DownloadParams;
  abortSignal: AbortSignal;
}>;
export async function resolveAndDispatch({ params, abortSignal }: ResolveAndDispatchParams) {
  const { type, videoId } = params;

  const cachedVideoData = videoDataCache.get(videoId);
  const isWatchPageForThisVideo =
    location.pathname === "/watch" &&
    new URLSearchParams(location.search).get("v") === videoId;

  const shouldUseIframe = self === top && (
    !cachedVideoData ||
    !isWatchPageForThisVideo ||
    isVideoDataExpired(cachedVideoData)
  );
  if (shouldUseIframe) {
    await crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadViaIframe, {
      ...params,
      isIframeFallback: true
    });
    return;
  }

  if (!cachedVideoData) {
    return;
  }

  await announceDownload({
    params,
    videoData: cachedVideoData
  });

  const {
    videoFormat,
    audioFormat,
    extraAudioFormats,
    captionTracks: orderedCaptionTracks
  } = resolveDownloadPlan({
    videoData: cachedVideoData,
    params
  });
  const captionExpectedBytesTotal = orderedCaptionTracks.length * CAPTION_ESTIMATED_BYTES;
  const totalExpectedBytes = readContentLength(videoFormat)
    + readContentLength(audioFormat)
    + extraAudioFormats.reduce((sum, format) => sum + readContentLength(format), 0)
    + captionExpectedBytesTotal;
  const captionVttDataPromise = fetchCaptionWebVttData({
    captionTracks: orderedCaptionTracks,
    videoId,
    captionBytesPerUnit: CAPTION_ESTIMATED_BYTES,
    totalExpectedBytes
  });

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
      sourceCaptionTracks: cachedVideoData.captionTracks,
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

  await crossWorldMessenger.sendMessage(CrossWorldMessage.StartBackgroundDownload, {
    requestJson: JSON.stringify(enrichedRequest)
  });
}
