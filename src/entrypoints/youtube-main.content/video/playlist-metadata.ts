import { cleanupSegmentedButton } from "../watch-button/watch-button";
import { buildAndDispatchVideoData } from "./capture-dispatch";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { playlistMetadataSignal } from "@/lib/ui/synced-stores.svelte";
import { type PlayerResponse } from "@/types";
import { PlayabilityStatus } from "@/types/youtube";

const WATCH_PATHNAME = "/watch";
const WATCH_FLEXY_TAG = "ytd-watch-flexy";
const WATCH_VIDEO_ID_PARAM = "v";
const PLAYER_DATA_POLL_ATTEMPTS = 20;
const PLAYER_DATA_POLL_INTERVAL_MS = 250;

declare global {
  interface HTMLElementTagNameMap {
    "ytd-watch-flexy": HTMLElement & {
      playerData: PlayerResponse | null;
    };
  }
}

export function extractPlaylistMetadata() {
  const { header, metadata } = window.ytInitialData ?? {};
  if (!header && !metadata) {
    playlistMetadataSignal.value = null;
    return;
  }

  const { playlistHeaderRenderer: headerRenderer } = header ?? {};
  const { playlistMetadataRenderer: metadataRenderer } = metadata ?? {};

  const playlistTitle = headerRenderer?.title?.simpleText ?? metadataRenderer?.title ?? "";
  const playlistId = headerRenderer?.playlistId ?? "";
  const playlistOwner = headerRenderer?.ownerText?.runs?.[0]?.text ?? "";
  if (!playlistTitle && !playlistId) {
    playlistMetadataSignal.value = null;
    return;
  }

  playlistMetadataSignal.value = {
    playlistId,
    playlistTitle,
    playlistOwner
  };
}

function handleNavigation() {
  cleanupSegmentedButton();
  void crossWorldMessenger.sendMessage(CrossWorldMessage.Navigation, { url: location.href });
  extractPlaylistMetadata();
}

export async function handleNavigateSuccess() {
  handleNavigation();

  if (location.pathname !== WATCH_PATHNAME) {
    return;
  }

  const expectedVideoId = new URLSearchParams(location.search).get(WATCH_VIDEO_ID_PARAM);

  for (let attempt = 0; attempt < PLAYER_DATA_POLL_ATTEMPTS; attempt++) {
    const playerResponse = document.querySelector(WATCH_FLEXY_TAG)?.playerData ?? null;
    const isReady = playerResponse?.videoDetails?.videoId === expectedVideoId
      && playerResponse.playabilityStatus?.status !== PlayabilityStatus.Unplayable;
    if (isReady) {
      await buildAndDispatchVideoData({ playerResponse });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, PLAYER_DATA_POLL_INTERVAL_MS));
  }
}
