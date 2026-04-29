import { injectSegmentedDownloadButton } from "../watch-button/watch-button";
import { activateIframeCaptureForVideo } from "./iframe-capture-state";
import { generatePoTokenIfNeeded } from "./po-token-manager";
import { buildVideoData } from "./youtube-api";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { videoDataStore } from "@/lib/ui/synced-stores.svelte";
import { type PlayerResponse, type VideoData, type YtdlCaptureState } from "@/types";

export type { YtdlCaptureState };
export { generatePoTokenIfNeeded };
export { buildVideoMetadata } from "./video-metadata";

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
