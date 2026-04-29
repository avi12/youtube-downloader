import { injectSegmentedDownloadButton } from "../watch-button/watch-button";
import { capturedPoToken, capturedPoTokenVideoId, setPoTokenCredentials } from "./credentials";
import { activateIframeCaptureForVideo } from "./iframe-capture-state";
import { parseDescriptionMetadata, parseMusicTitle, resolveGenresFromVideo } from "./music-metadata";
import { buildVideoData } from "./youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { sabrCredentials, videoDataStore } from "@/lib/ui/synced-stores.svelte";
import { generatePoToken, refreshPoToken } from "@/lib/youtube/po-token-generator";
import { type PlayerResponse, type VideoData, type YtdlCaptureState } from "@/types";

export type { YtdlCaptureState };

declare const ytcfg: { get: (key: string) => unknown } | undefined;

export const videoDataCache = new Map<string, VideoData>();

export function readYtcfg() {
  const clientVersionRaw = ytcfg?.get("INNERTUBE_CLIENT_VERSION");
  const clientVersion = typeof clientVersionRaw === "string" ? clientVersionRaw : "";
  const clientNameRaw = ytcfg?.get("INNERTUBE_CONTEXT_CLIENT_NAME");
  const clientName = typeof clientNameRaw === "number" ? clientNameRaw : 1;
  return {
    clientVersion,
    clientName
  };
}

export async function buildVideoMetadata(videoId: string) {
  const cached = videoDataCache.get(videoId);
  if (!cached) {
    return null;
  }

  const { playerResponse } = cached;
  const { videoDetails, microformat } = playerResponse;
  const thumbnails = videoDetails?.thumbnail?.thumbnails ?? [];
  const thumbnailUrl = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : undefined;
  const renderer = microformat?.playerMicroformatRenderer;
  const description = videoDetails?.shortDescription ?? "";
  const titleMeta = parseMusicTitle(cached.title);
  const descriptionMeta = parseDescriptionMetadata(description);
  const keywords = videoDetails?.keywords ?? [];
  const genres = await resolveGenresFromVideo({ keywords });
  const artist = descriptionMeta.artist || titleMeta.fullArtist || videoDetails?.author || "";
  const albumArtist = descriptionMeta.mainArtist || titleMeta.mainArtist || undefined;

  return {
    title: descriptionMeta.songTitle || titleMeta.songTitle,
    artist,
    albumArtist: albumArtist !== artist ? albumArtist : undefined,
    album: descriptionMeta.album,
    genres: genres.length > 0 ? genres : undefined,
    date: renderer?.publishDate,
    thumbnailUrl,
    isMusic: cached.isMusic
  };
}

export async function generatePoTokenIfNeeded(videoData: VideoData) {
  if (capturedPoToken && capturedPoTokenVideoId === videoData.videoId) {
    return;
  }

  try {
    const [poToken, alternateClientPoToken] = await Promise.all([
      generatePoToken({ videoId: videoData.videoId }),
      import.meta.env.FIREFOX
        ? generatePoToken({
          videoId: videoData.videoId,
          clientName: "ANDROID_VR",
          clientVersion: "1.65.10"
        }).catch(() => "")
        : Promise.resolve("")
    ]);
    const { serverAbrStreamingUrl: sabrUrl = "" } = videoData.sabrConfig ?? {};
    setPoTokenCredentials({
      poToken,
      alternateClientPoToken,
      sabrUrl,
      videoId: videoData.videoId
    });
    sabrCredentials.value = {
      url: sabrCredentials.value?.url || sabrUrl,
      poToken
    };
    startPoTokenRefreshBroadcast(videoData.videoId);
  } catch (error) {
    console.warn("[ytdl] PO token generation failed:", error);
  }
}

function readPlayerAudioLanguage() {
  const elPlayer = document.querySelector<HTMLElement & {
    getAudioTrack?: () => { language?: string } | null;
  }>("#movie_player");
  return elPlayer?.getAudioTrack?.()?.language ?? "";
}

function readPlayerCaptionLanguage() {
  const elPlayer = document.querySelector<HTMLElement & {
    getOption?: (module: string, key: string) => { languageCode?: string } | null;
  }>("#movie_player");
  return elPlayer?.getOption?.("captions", "track")?.languageCode ?? "";
}

export async function buildAndDispatchVideoData({ playerResponse, cancelActiveDownload, preferredAudioLanguage = "", preferredCaptionLanguage = "" }: {
  playerResponse: PlayerResponse;
  cancelActiveDownload: (videoId: string) => void;
  preferredAudioLanguage?: string;
  preferredCaptionLanguage?: string;
}) {
  const { clientVersion, clientName } = readYtcfg();
  const videoData = buildVideoData({
    playerResponse,
    clientVersion,
    clientName,
    preferredAudioLanguage,
    preferredCaptionLanguage
  });

  videoDataCache.set(videoData.videoId, videoData);
  videoDataStore.set(videoData.videoId, videoData);
  void crossWorldMessenger.sendMessage(CrossWorldMessage.VideoData, videoData);

  if (self !== top) {
    activateIframeCaptureForVideo(videoData);
    await generatePoTokenIfNeeded(videoData);
    return;
  }

  if (location.pathname === "/watch") {
    await injectSegmentedDownloadButton(videoData, cancelActiveDownload);
  }
}

const PLAYER_RESPONSE_POLL_ATTEMPTS = 20;
const PLAYER_RESPONSE_POLL_INTERVAL_MS = 250;

export async function extractAndDispatchVideoData(cancelActiveDownload: (videoId: string) => void) {
  if (!location.pathname.startsWith("/watch")) {
    return;
  }

  for (let attempt = 0; attempt < PLAYER_RESPONSE_POLL_ATTEMPTS; attempt++) {
    const playerResponse = window.ytInitialPlayerResponse ?? null;
    const isReady = playerResponse?.videoDetails?.videoId && playerResponse.playabilityStatus?.status !== "UNPLAYABLE";
    if (isReady) {
      await buildAndDispatchVideoData({
        playerResponse,
        cancelActiveDownload,
        preferredAudioLanguage: readPlayerAudioLanguage(),
        preferredCaptionLanguage: readPlayerCaptionLanguage()
      });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, PLAYER_RESPONSE_POLL_INTERVAL_MS));
  }
}
