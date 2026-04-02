/**
 * Isolated world content script - orchestrates UI injection and message bridging.
 *
 * UI injection is delegated to focused modules:
 * - panel-ui: DownloadOptionsPanel in the watch page dropdown
 * - playlist-ui: playlist header + per-video buttons
 * - grid-ui: per-video buttons on homepage/subscriptions/channel
 *
 * Data flow is delegated to:
 * - stream-transfer: chunked binary transfer to background
 * - sabr-credentials: PO token forwarding from background to MAIN world
 * - interrupted-downloads: resume state persistence
 */

import { cleanupGridUi, injectGridVideoButtons, isVideoGridPage } from "./grid-ui";
import { checkInterruptedDownload, listenForInterruptedDownloadEvents } from "./interrupted-downloads";
import { cleanupPanelUi, mountPanelUi } from "./panel-ui";
import { cleanupPlaylistUi, handlePlaylistVideoAdditions, injectPlaylistDownloaderUi } from "./playlist-ui";
import { handleStreamData, handleStreamError, setPlaylistContext } from "./stream-transfer";
import { crossWorldMessenger } from "@/lib/cross-world-messenger";
import { sendMessage, onMessage } from "@/lib/messaging";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/sabr-credentials";
import { optionsItem } from "@/lib/storage";
import { downloadProgressStore } from "@/lib/synced-stores.svelte";
import type { Options, VideoData } from "@/types";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  async main(context) {
    // ─── State ───────────────────────────────────────────────────────────

    let currentOptions: Options = await optionsItem.getValue();
    let currentVideoData: VideoData | null = null;

    // ─── Native download button visibility ──────────────────────────────

    const NATIVE_DOWNLOAD_SELECTOR = "ytd-download-button-renderer";

    function setNativeDownloadVisibility(isVisible: boolean) {
      for (const elButton of document.querySelectorAll<HTMLElement>(NATIVE_DOWNLOAD_SELECTOR)) {
        elButton.style.display = isVisible ? "" : "none";
      }
    }

    // ─── Navigation routing ─────────────────────────────────────────────

    async function handlePageChange(url: string) {
      const { pathname } = new URL(url);
      if (pathname === "/watch") {
        cleanupPlaylistUi();
        cleanupGridUi();
        cleanupPanelUi();
        setNativeDownloadVisibility(!currentOptions.isRemoveNativeDownload);
        return;
      }

      if (pathname === "/playlist") {
        cleanupPanelUi();
        cleanupGridUi();
        setNativeDownloadVisibility(true);
        injectPlaylistDownloaderUi(context, currentOptions);
        handlePlaylistVideoAdditions(context, currentOptions);
        return;
      }

      if (isVideoGridPage(pathname)) {
        cleanupPanelUi();
        cleanupPlaylistUi();
        setNativeDownloadVisibility(true);
        injectGridVideoButtons(context, currentOptions);
        return;
      }

      cleanupPanelUi();
      cleanupPlaylistUi();
      cleanupGridUi();
      setNativeDownloadVisibility(true);
    }

    // ─── Message bridging ───────────────────────────────────────────────

    // The MAIN world writes video data to the synced store (videoDataStore).
    // Components read from it reactively. But the orchestrator still needs
    // currentVideoData for the watch page panel mount.
    crossWorldMessenger.onMessage("videoData", async ({ data }) => {
      if (location.pathname === "/watch") {
        currentVideoData = data;
      }

      await checkInterruptedDownload(data.videoId);
    });

    crossWorldMessenger.onMessage("navigation", async ({ data }) => {
      currentVideoData = null;
      await handlePageChange(data.url);
      forwardSabrCredentialsWithRetry().catch(() => {});
    });

    crossWorldMessenger.onMessage("panelContentReady", async ({ data }) => {
      if (currentVideoData) {
        mountPanelUi(context, data.contentId, currentVideoData, currentOptions);
      }
    });

    crossWorldMessenger.onMessage("cancelDownload", async ({ data }) => {
      await sendMessage("cancelDownload", { videoIds: data.videoIds });
    });

    onMessage("executeDownloadItem", ({ data }) => {
      if (data.playlistId) {
        setPlaylistContext(data.videoId, {
          playlistId: data.playlistId,
          playlistTitle: data.playlistTitle ?? "Playlist",
          playlistTotalCount: data.playlistTotalCount ?? 1
        });
      }

      crossWorldMessenger.sendMessage("downloadRequest", data);
    });

    onMessage("updateDownloadProgress", ({ data }) => {
      crossWorldMessenger.sendMessage("progress", data);

      // Update synced store - components derive state reactively
      if (data.isRemoved) {
        downloadProgressStore.delete(data.videoId);
      } else {
        downloadProgressStore.set(data.videoId, {
          isDownloading: data.progress < 1,
          isDone: data.progress >= 1,
          isQueued: false,
          progress: data.progress,
          progressType: data.progressType
        });
      }
    });

    // ─── Event listeners ────────────────────────────────────────────────

    addEventListener("ytdl:stream-data", handleStreamData);
    context.onInvalidated(() => removeEventListener("ytdl:stream-data", handleStreamData));

    addEventListener("ytdl:stream-error", handleStreamError);
    context.onInvalidated(() => removeEventListener("ytdl:stream-error", handleStreamError));

    listenForInterruptedDownloadEvents();
    listenForSabrBodyReady();
    forwardSabrCredentialsWithRetry().catch(() => {});

    const unwatchOptions = optionsItem.watch(newOptions => {
      if (!newOptions) {
        return;
      }

      currentOptions = newOptions;
      setNativeDownloadVisibility(!currentOptions.isRemoveNativeDownload);
    });
    context.onInvalidated(unwatchOptions);

    // ─── Initial page handling ──────────────────────────────────────────

    await handlePageChange(location.href);
  }
});
