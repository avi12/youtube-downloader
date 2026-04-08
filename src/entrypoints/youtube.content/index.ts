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
import "./style.css";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { MessageType, sendMessage, onMessage } from "@/lib/messaging";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/sabr-credentials";
import { optionsItem } from "@/lib/storage";
import { downloadProgressStore, SYNC_NAMESPACE, SyncKey } from "@/lib/synced-stores.svelte";
import type { Options } from "@/types";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  allFrames: true,
  async main(context) {
    // Skip non-download iframes (ads, embeds). Only the main page and
    // download iframes (&ytdl=1) need full initialization.
    const isDownloadIframe = self !== top && location.search.includes("ytdl=1");
    if (self !== top && !isDownloadIframe) {
      return;
    }

    // ─── State ───────────────────────────────────────────────────────────

    let currentOptions: Options = await optionsItem.getValue();

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

    crossWorldMessenger.onMessage(CrossWorldMessage.VideoData, async ({ data }) => {
      await checkInterruptedDownload(data.videoId);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.Navigation, async ({ data }) => {
      if (!isDownloadIframe) {
        await handlePageChange(data.url);
      }

      void forwardSabrCredentialsWithRetry();
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.PanelContentReady, ({ data }) => {
      mountPanelUi({
        context,
        contentId: data.contentId,
        videoData: data.videoData,
        options: currentOptions
      });
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
      // Only handle on watch/embed pages (including download iframes).
      if (!/^\/(watch|embed\/)/.test(location.pathname)) {
        return;
      }

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

    // ─── SW keepalive ────────────────────────────────────────────────────
    // The background sends StartKeepalive after opening a watch tab for
    // grid downloads. We ping the SW every 25s to prevent Chrome from
    // killing it during long downloads.
    onMessage(MessageType.StartKeepalive, () => {
      const keepaliveInterval = setInterval(async () => {
        try {
          await sendMessage(MessageType.Keepalive, {});
        } catch {
          // SW died or extension reloaded - stop pinging
          clearInterval(keepaliveInterval);
        }
      }, 25_000);

      // Stop when the tab is closed or navigation changes
      addEventListener("beforeunload", () => {
        clearInterval(keepaliveInterval);
      });
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

    // ─── Hidden iframe for downloads ────────────────────────────────────
    // Creates a hidden iframe to a watch page. The MAIN world content script
    // spoofs visibilityState so YouTube's player streams in the iframe.
    // Iframe styling is in style.css (.ytdl-download-iframe).

    const downloadIframes = new Map<string, HTMLIFrameElement>();

    onMessage(MessageType.CreateDownloadIframe, ({ data }) => {
      const { videoId, watchUrl } = data;

      const existing = downloadIframes.get(videoId);
      if (existing) {
        existing.remove();
        downloadIframes.delete(videoId);
      }

      const elIframe = document.createElement("iframe");
      elIframe.classList.add("ytdl-download-iframe");
      elIframe.src = watchUrl;
      document.body.append(elIframe);
      downloadIframes.set(videoId, elIframe);

      elIframe.addEventListener("load", () => {
        void sendMessage(MessageType.DownloadIframeReady, { videoId });
      });

      context.onInvalidated(() => {
        elIframe.remove();
        downloadIframes.delete(videoId);
      });
    });

    const unwatchOptions = optionsItem.watch(newOptions => {
      if (!newOptions) {
        return;
      }

      currentOptions = newOptions;
      setNativeDownloadVisibility(!currentOptions.isRemoveNativeDownload);
    });
    context.onInvalidated(unwatchOptions);

    // ─── Initial page handling ──────────────────────────────────────────

    if (!isDownloadIframe) {
      await handlePageChange(location.href);
    }
  }
});
