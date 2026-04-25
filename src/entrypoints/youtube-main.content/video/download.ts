import { capturedAlternateClientPoToken, capturedPoToken, capturedSabrUrl, setPoTokenCredentials } from "./credentials";
import { resolveFormatUrl } from "./stream-fetch";
import { buildVideoMetadata, generatePoTokenIfNeeded, videoDataCache } from "./video-data";
import { crossWorldMessenger, CrossWorldMessage } from "@/lib/messaging/cross-world-messenger";
import { sabrCredentials } from "@/lib/ui/synced-stores.svelte";
import { type AdaptiveFormatItem, type DownloadRequest, DownloadType } from "@/types";

const IFRAME_SCRUB_STEP_SEC = 300;

// Firefox's background SABR gets LOGIN_REQUIRED / attestation_required for
// any video long enough to trip YouTube's per-session threshold (somewhere
// between ~4 and ~10 min). The iframe-scrub path works around it by riding
// the trust of the iframe's own player session. Keep off for Chrome since
// Chrome's background SABR still clears the wall more often.
const IFRAME_SCRUB_MIN_DURATION_SEC = 240;

const activeDownloads = new Map<string, AbortController>();

export function cancelActiveDownload(videoId: string) {
  const controller = activeDownloads.get(videoId);
  if (controller) {
    controller.abort();
    activeDownloads.delete(videoId);
  }
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

    const videoDurationMs = parseInt(videoFormat?.approxDurationMs ?? audioFormat?.approxDurationMs ?? "0", 10);
    const videoDurationSec = Math.ceil(videoDurationMs / 1000);
    const useIframeScrub = import.meta.env.FIREFOX
      && videoDurationSec >= IFRAME_SCRUB_MIN_DURATION_SEC
      && !/ytdlKeepPlaying=1|ytdlScrubMode=1/.test(location.search);
    if (useIframeScrub) {
      console.log(`[ytdl] iframe-scrub path for ${videoId} (${videoDurationSec}s) — handing off to background`);
      void crossWorldMessenger.sendMessage(CrossWorldMessage.StartIframeScrub, {
        videoId,
        durationSec: videoDurationSec,
        stepSec: IFRAME_SCRUB_STEP_SEC,
        type,
        filenameOutput,
        videoMimeType: videoFormat?.mimeType?.split(";")[0] || "video/mp4",
        audioMimeType: audioFormat?.mimeType?.split(";")[0] || "audio/mp4",
        audioLabel: audioFormat?.audioTrack?.displayName ?? "",
        metadata,
        playlistId,
        playlistTitle,
        playlistTotalCount
      });
      return;
    }

    // YouTube's SPA strips ?query params on watch navigation, so read from the
    // hash fragment instead. Trigger via e.g. #ytdlDebugRangedFromSec=600
    const debugRangedMatch = location.hash.match(/ytdlDebugRangedFromSec=(\d+)/);
    const debugRangedFromSec = debugRangedMatch ? parseInt(debugRangedMatch[1], 10) : undefined;

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
      debugRangedFromSec,
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
      captionTracks: cachedVideoData.captionTracks
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
