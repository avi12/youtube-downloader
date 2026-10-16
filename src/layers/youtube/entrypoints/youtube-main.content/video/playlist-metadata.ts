import { cleanupSegmentedButton } from "../watch-button/watch-button";
import { buildAndDispatchVideoData, type ShortsPageData } from "./capture-dispatch";
import { getPageRoute, getRouteVideoId, PageRoute } from "./page-route";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { playlistMetadataSignal } from "@/lib/ui/synced-stores.svelte";
import { type PlayerResponse } from "@/types";

const WATCH_FLEXY_TAG = "ytd-watch-flexy";
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
  const hasNoPlaylistData = !header && !metadata;
  if (hasNoPlaylistData) {
    playlistMetadataSignal.value = null;
    return;
  }

  const { playlistHeaderRenderer: headerRenderer } = header ?? {};
  const { playlistMetadataRenderer: metadataRenderer } = metadata ?? {};

  const playlistTitle = headerRenderer?.title?.simpleText ?? metadataRenderer?.title ?? "";
  const playlistId = headerRenderer?.playlistId ?? "";
  const playlistOwner = headerRenderer?.ownerText?.runs?.[0]?.text ?? "";
  const hasNoPlaylistIdentifier = !playlistTitle && !playlistId;
  if (hasNoPlaylistIdentifier) {
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
  crossWorldMessenger.sendMessage(CrossWorldMessage.Navigation, { url: location.href }).catch(() => {});
  extractPlaylistMetadata();
}

type NavigateResponse = {
  playerResponse?: PlayerResponse;
  response?: ShortsPageData;
};

function readNavigateResponse(e: Event) {
  const isCustomEvent = e instanceof CustomEvent;
  if (!isCustomEvent) {
    return null;
  }

  const detail: { response?: NavigateResponse } | null = e.detail;
  return detail?.response ?? null;
}

export async function handleNavigateSuccess(e: Event) {
  handleNavigation();

  const route = getPageRoute();
  const expectedVideoId = getRouteVideoId();
  if (route === PageRoute.Shorts) {
    const navigateResponse = readNavigateResponse(e);
    const playerResponse = navigateResponse?.playerResponse;
    const isMatchingShort = playerResponse?.videoDetails?.videoId === expectedVideoId;
    if (isMatchingShort) {
      await buildAndDispatchVideoData({
        playerResponse,
        shortsPageData: navigateResponse?.response
      });
    }

    return;
  }

  if (route !== PageRoute.Watch) {
    return;
  }

  for (let attempt = 0; attempt < PLAYER_DATA_POLL_ATTEMPTS; attempt++) {
    const playerResponse = document.querySelector(WATCH_FLEXY_TAG)?.playerData ?? null;
    const isReady = playerResponse?.videoDetails?.videoId === expectedVideoId;
    if (isReady) {
      await buildAndDispatchVideoData({ playerResponse });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, PLAYER_DATA_POLL_INTERVAL_MS));
  }
}
