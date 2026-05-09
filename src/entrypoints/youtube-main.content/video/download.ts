import { capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./credentials";
import { resolveFormatUrl } from "./stream-fetch";
import { buildVideoMetadata, generatePoTokenIfNeeded, videoDataCache } from "./video-data";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import { contentOptions, sabrCredentials } from "@/lib/ui/synced-stores.svelte";
import { isVideoDataExpired, orderCaptionsByPreference } from "@/lib/youtube/video-helpers";
import { type AdaptiveFormatItem, type DownloadRequest, DownloadType, ProgressType } from "@/types";

const activeDownloads = new Map<string, AbortController>();

export function cancelActiveDownload(videoId: string) {
  const controller = activeDownloads.get(videoId);
  if (controller) {
    controller.abort();
    activeDownloads.delete(videoId);
  }
}

export function cancelAllActiveDownloads() {
  const videoIds = [...activeDownloads.keys()];
  for (const controller of activeDownloads.values()) {
    controller.abort();
  }
  activeDownloads.clear();
  return videoIds;
}

function getExtraAudioFormats({ audioFormats, selectedTrackId }: {
  audioFormats: AdaptiveFormatItem[];
  selectedTrackId: string | undefined;
}) {
  if (!selectedTrackId) {
    return [];
  }

  const seenTrackIds = new Set([selectedTrackId]);
  return audioFormats.filter(format => {
    const trackId = format.audioTrack?.id;
    if (!trackId || seenTrackIds.has(trackId)) {
      return false;
    }

    seenTrackIds.add(trackId);
    return true;
  });
}

function resolveCredentials() {
  const creds = sabrCredentials.value;
  const elCredentials = document.getElementById("ytdl-sabr-credentials");

  const currentPoToken =
    creds?.poToken ||
    elCredentials?.dataset.poToken ||
    capturedPoToken;

  const currentSabrUrl =
    creds?.url ||
    elCredentials?.dataset.url ||
    capturedSabrUrl;
  if (currentPoToken !== capturedPoToken || currentSabrUrl !== capturedSabrUrl) {
    setPoTokenCredentials({
      poToken: currentPoToken ?? "",
      sabrUrl: currentSabrUrl ?? ""
    });
  }

  return {
    poToken: currentPoToken,
    sabrUrl: currentSabrUrl
  };
}

const CREDENTIAL_POLL_INTERVAL_MS = 200;
const CREDENTIAL_POLL_MAX_WAIT_MS = 5000;

async function resolveCredentialsWithRetry() {
  const initial = resolveCredentials();
  if (initial.poToken) {
    return initial;
  }

  const deadline = Date.now() + CREDENTIAL_POLL_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, CREDENTIAL_POLL_INTERVAL_MS));
    const result = resolveCredentials();
    if (result.poToken) {
      return result;
    }
  }

  return resolveCredentials();
}

function selectFormats({ videoData, type, videoItag, audioItag }: {
  videoData: {
    videoFormats: AdaptiveFormatItem[];
    audioFormats: AdaptiveFormatItem[];
  };
  type: DownloadType;
  videoItag: number | undefined;
  audioItag: number | undefined;
}) {
  const videoFormat = type !== DownloadType.Audio
    ? (videoData.videoFormats.find(format => format.itag === videoItag) ?? videoData.videoFormats[0])
    : null;
  const audioFormat = type !== DownloadType.Video
    ? (videoData.audioFormats.find(format => format.itag === audioItag) ?? videoData.audioFormats[0])
    : null;

  return {
    videoFormat,
    audioFormat
  };
}

async function preResolveCdnUrls({ type, videoFormat, audioFormat, extraAudioFormats }: {
  type: DownloadType;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem | null;
  extraAudioFormats: AdaptiveFormatItem[];
}) {
  return Promise.all([
    type !== DownloadType.Audio ? resolveFormatUrl(videoFormat) : Promise.resolve(null),
    type !== DownloadType.Video ? resolveFormatUrl(audioFormat) : Promise.resolve(null),
    ...extraAudioFormats.map(format => resolveFormatUrl(format))
  ]);
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

  emitCrossWorldEvent({
    type: CrossWorldEvent.ProgressUpdate,
    data: {
      videoId,
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: false
    }
  });

  try {
    const cachedVideoData = videoDataCache.get(videoId);
    if (!cachedVideoData) {
      console.error("[ytdl] No video data cached for", videoId);
      return;
    }

    if (self === top && isVideoDataExpired(cachedVideoData)) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadViaIframe, {
        type,
        videoId,
        videoItag,
        audioItag,
        filenameOutput,
        isIframeFallback: true,
        playlistId,
        playlistTitle,
        playlistTotalCount
      });
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
    await generatePoTokenIfNeeded(cachedVideoData);
    const credentials = await resolveCredentialsWithRetry();

    const [resolvedVideoUrl, resolvedAudioUrl, ...resolvedExtraAudioUrls] =
      await preResolveCdnUrls({
        type,
        videoFormat,
        audioFormat,
        extraAudioFormats
      });
    const metadata = await buildVideoMetadata(videoId);
    const options = contentOptions.value;
    const orderedCaptionTracks = orderCaptionsByPreference({
      captionTracks: cachedVideoData.captionTracks,
      languageMode: options.audioTrackLanguageMode,
      locale: document.documentElement.lang
    });

    const enrichedRequest: DownloadRequest = {
      type,
      videoId,
      videoItag,
      audioItag,
      filenameOutput,
      isIframeFallback,
      sabrConfig: cachedVideoData.sabrConfig,
      poToken: credentials.poToken,
      sabrUrl: credentials.sabrUrl,
      videoFormat,
      audioFormat,
      additionalAudioFormats: extraAudioFormats,
      primaryAudioLabel: audioFormat?.audioTrack?.displayName ?? "",
      captionTracks: orderedCaptionTracks,
      metadata,
      resolvedVideoUrl,
      resolvedAudioUrl,
      resolvedExtraAudioUrls,
      playlistId,
      playlistTitle,
      playlistTotalCount
    };    if (abortController.signal.aborted) {
      return;
    }

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
