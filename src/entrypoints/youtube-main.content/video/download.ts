import { capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./credentials";
import { resolveFormatUrl } from "./stream-fetch";
import { buildVideoMetadata, generatePoTokenIfNeeded, videoDataCache } from "./video-data";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import { contentOptions, sabrCredentials } from "@/lib/ui/synced-stores.svelte";
import { uint8ToBase64 } from "@/lib/utils/binary";
import { isVideoDataExpired, orderCaptionsByPreference } from "@/lib/youtube/video-helpers";
import { type AdaptiveFormatItem, type CaptionTrack, type DownloadRequest, DownloadType, ProgressType } from "@/types";

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

const MAX_ADDITIONAL_AUDIO_TRACKS = 16;

function getExtraAudioFormats({ audioFormats, selectedTrackId, selectedFormat }: {
  audioFormats: AdaptiveFormatItem[];
  selectedTrackId: string | undefined;
  selectedFormat: AdaptiveFormatItem | null;
}) {
  const seenTrackIds = new Set(selectedTrackId ? [selectedTrackId] : []);
  // If the primary is untagged (original language), mark it as already represented
  // so we skip other untagged formats. If the primary is a dubbed track, we still
  // want to include the original untagged track as an extra.
  let hasUntaggedExtra = !selectedTrackId;
  const result: AdaptiveFormatItem[] = [];
  for (const format of audioFormats) {
    if (result.length >= MAX_ADDITIONAL_AUDIO_TRACKS) {
      break;
    }

    if (format === selectedFormat) {
      continue;
    }

    const trackId = format.audioTrack?.id;
    if (!trackId) {
      if (hasUntaggedExtra) {
        continue;
      }

      hasUntaggedExtra = true;
      result.push(format);
      continue;
    }

    if (seenTrackIds.has(trackId)) {
      continue;
    }

    seenTrackIds.add(trackId);
    result.push(format);
  }

  return result;
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

async function fetchCaptionVttData(captionTracks: CaptionTrack[], poToken: string | undefined) {
  return Promise.all(
    captionTracks.map(async track => {
      try {
        const potParam = poToken ? `&potc=1&pot=${encodeURIComponent(poToken)}` : "";
        const response = await fetch(`${track.baseUrl}&fmt=vtt${potParam}`);
        if (!response.ok) {
          return null;
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength === 0) {
          return null;
        }
        return uint8ToBase64(new Uint8Array(buffer));
      } catch {
        return null;
      }
    })
  );
}

function selectFormats({ videoData, type, videoItag, audioItag, audioTrackId }: {
  videoData: {
    videoFormats: AdaptiveFormatItem[];
    audioFormats: AdaptiveFormatItem[];
  };
  type: DownloadType;
  videoItag: number | undefined;
  audioItag: number | undefined;
  audioTrackId: string | undefined;
}) {
  const videoFormat = type !== DownloadType.Audio
    ? (videoData.videoFormats.find(format => format.itag === videoItag) ?? videoData.videoFormats[0])
    : null;

  let audioFormat: AdaptiveFormatItem | null = null;
  if (type !== DownloadType.Video) {
    const byItag = videoData.audioFormats.filter(format => format.itag === audioItag);
    audioFormat = (audioTrackId
      ? byItag.find(format => format.audioTrack?.id === audioTrackId)
      : null)
      ?? byItag[0]
      ?? videoData.audioFormats[0];
  }

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
  audioTrackId,
  filenameOutput,
  isIframeFallback,
  playlistId,
  playlistTitle,
  playlistTotalCount
}: Pick<DownloadRequest, "type" | "videoId" | "videoItag" | "audioItag" | "audioTrackId" | "filenameOutput" | "isIframeFallback" | "playlistId" | "playlistTitle" | "playlistTotalCount">) {
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
        audioTrackId,
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
      audioItag,
      audioTrackId
    });
    const extraAudioFormats = getExtraAudioFormats({
      audioFormats: cachedVideoData.audioFormats,
      selectedTrackId: audioFormat?.audioTrack?.id,
      selectedFormat: audioFormat
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
      locale: document.documentElement.lang,
      browserLanguage: navigator.language
    });
    const captionVttData = await fetchCaptionVttData(orderedCaptionTracks, credentials.poToken);

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
      primaryAudioLabel: (audioFormat?.audioTrack?.displayName ?? "").replace(/ [-–—] \[.*?\]$/, "").trim(),
      primaryAudioLanguageCode: audioFormat?.audioTrack?.id?.split(".")[0] ?? "",
      captionTracks: orderedCaptionTracks,
      captionVttData,
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

    void crossWorldMessenger.sendMessage(CrossWorldMessage.StartBackgroundDownload, {
      requestJson: JSON.stringify(enrichedRequest)
    });
  } catch (error) {
    if (abortController.signal.aborted) {
      return;
    }

    throw error;
  } finally {
    activeDownloads.delete(videoId);
  }
}
