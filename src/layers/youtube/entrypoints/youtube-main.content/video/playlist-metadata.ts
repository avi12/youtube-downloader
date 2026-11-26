import { isCustomEvent } from "@/lib/dom-guards";
import { cleanupSegmentedButton } from "@/layers/youtube/entrypoints/youtube-main.content/watch-button/watch-button";
import { buildAndDispatchVideoData, shortsPageDataSchema } from "./capture-dispatch";
import { getPageRoute, getRouteVideoId, PageRoute } from "./page-route";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { playlistMetadataSignal } from "@/lib/ui/synced-stores.svelte";
import { isPlayerResponse } from "@/lib/youtube/schemas";
import { z } from "@/lib/zod";
import { createGuard } from "@/lib/zod-guard";
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

const isNavigateDetail = createGuard(
  z.looseObject({
    response: z.looseObject({
      playerResponse: z.unknown(),
      response: shortsPageDataSchema.optional()
    })
  })
);

function readNavigateResponse(event: Event) {
  if (!isCustomEvent(event)) {
    return null;
  }

  const { detail } = event;
  return isNavigateDetail(detail) ? detail.response : null;
}

export async function handleNavigateSuccess(event: Event) {
  handleNavigation();

  const route = getPageRoute();
  const expectedVideoId = getRouteVideoId();
  if (route === PageRoute.Shorts) {
    const navigateResponse = readNavigateResponse(event);
    const playerResponse = navigateResponse?.playerResponse;
    const isMatchingShort = isPlayerResponse(playerResponse) && playerResponse.videoDetails?.videoId === expectedVideoId;
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
