import { cleanupSegmentedButton } from "../watch-button/watch-button";
import { cancelActiveDownload } from "./download";
import { buildAndDispatchVideoData } from "./video-data";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { playlistMetadataSignal } from "@/lib/ui/synced-stores.svelte";
import { type PlayerResponse } from "@/types";

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
      await buildAndDispatchVideoData({
        playerResponse,
        cancelActiveDownload
      });
      return;
    }

    await new Promise(resolve => setTimeout(resolve, playerDataPollIntervalMs));
  }

  // On full page loads, ytd-watch-flexy.playerData may not be set in time.
  // Fall back to the initial player response embedded in the page HTML.
  const initialResponse = window.ytInitialPlayerResponse ?? null;
  const isFallbackReady = initialResponse?.videoDetails?.videoId === expectedVideoId
    && initialResponse.playabilityStatus?.status !== "UNPLAYABLE";
  if (isFallbackReady) {
    await buildAndDispatchVideoData({
      playerResponse: initialResponse,
      cancelActiveDownload
    });
  }
}
