import { capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./credentials";
import { resolveFormatUrl } from "./stream-fetch";
import { buildVideoMetadata, generatePoTokenIfNeeded, videoDataCache } from "./video-data";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import { sabrCredentials } from "@/lib/ui/synced-stores.svelte";
import { type AdaptiveFormatItem, type DownloadRequest, DownloadType } from "@/types";

const activeDownloads = new Map<string, AbortController>();

export function cancelActiveDownload(videoId: string) {
  const controller = activeDownloads.get(videoId);
  if (controller) {
    controller.abort();
    activeDownloads.delete(videoId);
  }
}

function getExtraAudioFormats(
  audioFormats: AdaptiveFormatItem[],
  selectedTrackId: string | undefined
) {
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
  let currentPoToken = capturedPoToken;
  let currentSabrUrl = capturedSabrUrl;

  const creds = sabrCredentials.value;
  if (creds?.url) {
    currentSabrUrl = creds.url;
  }

  if (!currentPoToken && creds?.poToken) {
    currentPoToken = creds.poToken;
  }

  if (!currentPoToken || !currentSabrUrl) {
    const elCredentials = document.getElementById("ytdl-sabr-credentials");
    if (elCredentials?.dataset.url) {
      currentSabrUrl = elCredentials.dataset.url;
    }

    if (!currentPoToken && elCredentials?.dataset.poToken) {
      currentPoToken = elCredentials.dataset.poToken;
    }
  }

  if (currentPoToken !== capturedPoToken || currentSabrUrl !== capturedSabrUrl) {
    setPoTokenCredentials(currentPoToken, currentSabrUrl);
  }

  return { poToken: currentPoToken, sabrUrl: currentSabrUrl };
}

const credentialPollIntervalMs = 200;
const credentialPollMaxWaitMs = 5000;

async function resolveCredentialsWithRetry() {
  const initial = resolveCredentials();
  if (initial.poToken) {
    return initial;
  }

  const deadline = Date.now() + credentialPollMaxWaitMs;
  while (Date.now() < deadline) {
    await new Promise<void>(resolve => setTimeout(resolve, credentialPollIntervalMs));
    const result = resolveCredentials();
    if (result.poToken) {
      return result;
    }
  }

  return resolveCredentials();
}

function selectFormats(
  videoData: {
    videoFormats: AdaptiveFormatItem[];
    audioFormats: AdaptiveFormatItem[];
  },
  type: DownloadType,
  videoItag: number | undefined,
  audioItag: number | undefined
) {
  const videoFormat = type !== DownloadType.Audio
    ? (videoData.videoFormats.find(format => format.itag === videoItag) ?? videoData.videoFormats[0])
    : null;
  const audioFormat = type !== DownloadType.Video
    ? (videoData.audioFormats.find(format => format.itag === audioItag) ?? videoData.audioFormats[0])
    : null;

  return { videoFormat, audioFormat };
}

async function preResolveCdnUrls(
  type: DownloadType,
  videoFormat: AdaptiveFormatItem | null,
  audioFormat: AdaptiveFormatItem | null,
  extraAudioFormats: AdaptiveFormatItem[]
) {
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

  try {
    const cachedVideoData = videoDataCache.get(videoId);
    if (!cachedVideoData) {
      console.error("[ytdl] No video data cached for", videoId);
      return;
    }

    const { videoFormat, audioFormat } = selectFormats(cachedVideoData, type, videoItag, audioItag);
    const extraAudioFormats = getExtraAudioFormats(cachedVideoData.audioFormats, audioFormat?.audioTrack?.id);
    // BotGuard's synchronous VM briefly blocks the main thread,
    // so do it at click-time (expected latency) rather than download completion.
    await generatePoTokenIfNeeded(cachedVideoData);
    const credentials = await resolveCredentialsWithRetry();

    const [resolvedVideoUrl, resolvedAudioUrl, ...resolvedExtraAudioUrls] =
      await preResolveCdnUrls(type, videoFormat, audioFormat, extraAudioFormats);
    const metadata = await buildVideoMetadata(videoId);

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
      metadata,
      resolvedVideoUrl,
      resolvedAudioUrl,
      resolvedExtraAudioUrls,
      playlistId,
      playlistTitle,
      playlistTotalCount
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
