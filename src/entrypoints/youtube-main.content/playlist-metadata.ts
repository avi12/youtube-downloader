import { cancelActiveDownload } from "./download";
import { buildAndDispatchVideoData } from "./video-data";
import { cleanupSegmentedButton } from "./watch-button";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { playlistMetadataSignal } from "@/lib/synced-stores.svelte";
import { type PlayerResponse } from "@/types";

declare global {
  interface HTMLElementTagNameMap {
    "ytd-watch-flexy": HTMLElement & {
      playerData: PlayerResponse | null;
    };
  }
}

function extractPlaylistMetadata() {
  const { header, metadata } = window.ytInitialData ?? {};
  if (!header && !metadata) {
    playlistMetadataSignal.value = null;
    return;
  }

  const { playlistHeaderRenderer: headerRenderer } = header ?? {};
  const { playlistMetadataRenderer: metadataRenderer } = metadata ?? {};

  const playlistTitle = headerRenderer?.title?.simpleText ?? metadataRenderer?.title ?? "";
  const playlistId = headerRenderer?.playlistId ?? "";
  if (!playlistTitle && !playlistId) {
    playlistMetadataSignal.value = null;
    return;
  }

  playlistMetadataSignal.value = { playlistId, playlistTitle };
}

function handleNavigation() {
  cleanupSegmentedButton();
  void crossWorldMessenger.sendMessage(CrossWorldMessage.Navigation, { url: location.href });
  extractPlaylistMetadata();
}

export async function handleNavigateSuccess() {
  handleNavigation();

  if (location.pathname !== "/watch") {
    return;
  }

  // YouTube updates ytd-watch-flexy.playerData asynchronously after
  // navigation. Poll briefly until it matches the current video ID.
  const playerDataPollAttempts = 20;
  const playerDataPollIntervalMs = 250;
  const expectedVideoId = new URLSearchParams(location.search).get("v");

  for (let attempt = 0; attempt < playerDataPollAttempts; attempt++) {
    const playerResponse = document.querySelector("ytd-watch-flexy")?.playerData ?? null;
    const isReady = playerResponse?.videoDetails?.videoId === expectedVideoId
      && playerResponse.playabilityStatus?.status !== "UNPLAYABLE";
    if (isReady) {
      await buildAndDispatchVideoData(playerResponse, cancelActiveDownload);
      return;
    }

    await new Promise(resolve => setTimeout(resolve, playerDataPollIntervalMs));
  }
}
