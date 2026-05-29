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
import { getCompatibleFilename, splitFilenameAndExtension } from "@/lib/utils/filename";
import { CAPTION_ESTIMATED_BYTES } from "@/lib/youtube/download-progress";
import { isVideoDataExpired } from "@/lib/youtube/video-helpers";
import type { AdaptiveFormatItem, CaptionTrack, DownloadRequest, TranslationLanguage } from "@/types";

const TRANSLATED_CAPTION_VSSID_PREFIX = "t.";

function readContentLength(format: AdaptiveFormatItem | null) {
  if (!format?.contentLength) {
    return 0;
  }

  const bytes = Number(format.contentLength);
  return Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function buildVirtualTranslatedTrack(
  vssId: string,
  captionTracks: CaptionTrack[],
  translationLanguages: TranslationLanguage[]
) {
  const isTranslatedCaption = vssId.startsWith(TRANSLATED_CAPTION_VSSID_PREFIX);
  if (!isTranslatedCaption) {
    return null;
  }

  const targetLangCode = vssId.slice(TRANSLATED_CAPTION_VSSID_PREFIX.length);
  const translationLang = translationLanguages.find(lang => lang.languageCode === targetLangCode);
  const sourceTrack = captionTracks.find(track => track.isTranslatable);
  const isMissingTranslationData = !translationLang || !sourceTrack;
  if (isMissingTranslationData) {
    return null;
  }

  return {
    baseUrl: sourceTrack.baseUrl,
    name: translationLang.languageName,
    vssId,
    languageCode: targetLangCode,
    isTranslatable: false,
    translationLanguageCode: targetLangCode,
    sourceTrackVssId: sourceTrack.vssId
  };
}

const PROGRESSIVE_DOWNLOAD_EXTENSION = "mp4";

type TryProgressiveInPageParams = {
  url: string;
  filenameOutput: string;
  videoId: string;
};
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

export type DownloadParams = Pick<DownloadRequest,
  "type" | "videoId" | "videoItag" | "audioItag" | "audioTrackId" |
  "selectedCaptionVssId" | "filenameOutput" | "isIframeFallback" |
  "downloadExtras" | "downloadExtraCaptions" | "includeAutoDubbing" |
  "playlistId" | "playlistTitle" | "playlistTotalCount" |
  "originTabId"
>;

type ResolveAndDispatchParams = {
  params: DownloadParams;
  abortSignal: AbortSignal;
};
export async function resolveAndDispatch({ params, abortSignal }: ResolveAndDispatchParams) {
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

  const downloadExtras = params.downloadExtras ?? true;
  const downloadExtraCaptions = params.downloadExtraCaptions ?? true;
  const includeAutoDubbing = params.includeAutoDubbing ?? true;
  const virtualTrack = selectedCaptionVssId
    ? buildVirtualTranslatedTrack(
      selectedCaptionVssId,
      cachedVideoData.captionTracks,
      cachedVideoData.translationLanguages
    )
    : null;
  const captionTracksForResolution = virtualTrack
    ? [...cachedVideoData.captionTracks, virtualTrack]
    : cachedVideoData.captionTracks;
  const orderedCaptionTracks = resolveOrderedCaptionTracks({
    captionTracks: captionTracksForResolution,
    selectedCaptionVssId,
    downloadExtras: downloadExtraCaptions
  });
  const { videoFormat, audioFormat } = selectFormats({
    videoData: cachedVideoData,
    type,
    videoItag,
    audioItag,
    audioTrackId
  });
  const extraAudioFormats = downloadExtras
    ? getExtraAudioFormats({
      audioFormats: cachedVideoData.audioFormats,
      selectedTrackId: audioFormat?.audioTrack?.id,
      selectedFormat: audioFormat,
      includeAutoDubbing
    })
    : [];
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
