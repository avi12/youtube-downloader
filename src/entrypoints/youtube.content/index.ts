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
import { listenForDownloadRequests } from "./sabr-download";
import {
  cancelStreamTransfer,
  handleStreamData,
  handleStreamError,
  setPlaylistContext,
  uncancelStreamTransfer
} from "./stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { MessageType, sendMessage, onMessage } from "@/lib/messaging";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/sabr-credentials";
import { optionsItem } from "@/lib/storage";
import { downloadProgressStore, SYNC_NAMESPACE, SyncKey } from "@/lib/synced-stores.svelte";
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
    crossWorldMessenger.onMessage(CrossWorldMessage.VideoData, async ({ data }) => {
      if (location.pathname === "/watch") {
        currentVideoData = data;
      }

      await checkInterruptedDownload(data.videoId);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.Navigation, async ({ data }) => {
      currentVideoData = null;
      await handlePageChange(data.url);
      void forwardSabrCredentialsWithRetry();
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.PanelContentReady, ({ data }) => {
      if (currentVideoData) {
        mountPanelUi({
          context, contentId: data.contentId, videoData: currentVideoData, options: currentOptions
        });
      }
    });

    addEventListener("message", e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.CancelRequest) {
        return;
      }

      const { videoIds } = e.data.value ?? {};
      if (!videoIds) {
        return;
      }

      for (const id of videoIds) {
        cancelStreamTransfer(id);
      }

      void sendMessage(MessageType.CancelDownload, { videoIds });

      // Notify MAIN world to abort active fetches via postMessage
      // (not crossWorldMessenger, which would loop back to our own handler)
      postMessage({
        namespace: SYNC_NAMESPACE,
        key: SyncKey.CancelDownload,
        value: { videoIds }
      }, location.origin);
    });

    onMessage(MessageType.ExecuteDownloadItem, ({ data }) => {
      if (data.playlistId) {
        setPlaylistContext(data.videoId, {
          playlistId: data.playlistId,
          playlistTitle: data.playlistTitle ?? "Playlist",
          playlistTotalCount: data.playlistTotalCount ?? 1
        });
      }

      uncancelStreamTransfer(data.videoId);
      void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, data);
    });

    // Proxy fetch requests from MAIN world through the background
    crossWorldMessenger.onMessage(CrossWorldMessage.ProxyFetch, ({ data }) => {
      return sendMessage(MessageType.ProxyFetch, data);
    });

    // Relay PO token refresh requests from background to MAIN world
    onMessage(MessageType.RefreshPoToken, ({ data }) => {
      return crossWorldMessenger.sendMessage(CrossWorldMessage.RefreshPoToken, data);
    });

    onMessage(MessageType.UpdateDownloadProgress, ({ data }) => {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.Progress, data);

      // Update synced store - components derive state reactively
      if (data.isRemoved) {
        downloadProgressStore.set(data.videoId, {
          isDownloading: false,
          isDone: true,
          isQueued: false,
          progress: 1,
          progressType: ""
        });
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

    addEventListener("message", e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.StreamData) {
        return;
      }

      void handleStreamData(e.data.value);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.StreamError, ({ data }) => {
      void handleStreamError(data);
    });

    listenForInterruptedDownloadEvents();
    listenForSabrBodyReady();
    listenForDownloadRequests();
    void forwardSabrCredentialsWithRetry();

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
