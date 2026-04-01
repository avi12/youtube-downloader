/**
 * Isolated world content script - orchestrates UI injection and message bridging.
 *
 * Delegates to focused modules:
 * - stream-transfer: chunked binary transfer to background
 * - sabr-credentials: PO token forwarding from background to MAIN world
 * - interrupted-downloads: resume state persistence
 */

import { checkInterruptedDownload, listenForInterruptedDownloadEvents } from "./interrupted-downloads";
import { handleStreamData, handleStreamError, setPlaylistContext } from "./stream-transfer";
import DownloadOptionsPanel from "@/components/DownloadOptionsPanel.svelte";
import PlaylistDownloader from "@/components/PlaylistDownloader.svelte";
import PlaylistVideoItem from "@/components/PlaylistVideoItem.svelte";
import { crossWorldMessenger } from "@/lib/cross-world-messenger";
import { sendMessage, onMessage } from "@/lib/messaging";
import { forwardSabrCredentialsWithRetry, listenForSabrBodyReady } from "@/lib/sabr-credentials";
import { optionsItem } from "@/lib/storage";
import type { Options, VideoData } from "@/types";
import { mount, unmount } from "svelte";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  async main(context) {
    // ─── State ───────────────────────────────────────────────────────────

    let currentPlaylistUi: ReturnType<typeof mount> | null = null;
    let currentPanelSvelteInstance: ReturnType<typeof mount> | null = null;
    let currentOptions: Options = await optionsItem.getValue();
    let currentVideoData: VideoData | null = null;

    // ─── UI cleanup ─────────────────────────────────────────────────────

    function cleanupPlaylistUi() {
      if (!currentPlaylistUi) {
        return;
      }

      unmount(currentPlaylistUi);
      currentPlaylistUi = null;

      for (const elItem of document.querySelectorAll("[data-ytdl-playlist-downloader]")) {
        elItem.remove();
      }
    }

    function cleanupPanelUi() {
      if (!currentPanelSvelteInstance) {
        return;
      }

      unmount(currentPanelSvelteInstance);
      currentPanelSvelteInstance = null;
    }

    let gridObserver: MutationObserver | null = null;

    function cleanupGridUi() {
      gridObserver?.disconnect();
      gridObserver = null;

      for (const elItem of document.querySelectorAll("[data-ytdl-grid-item]")) {
        elItem.remove();
      }
    }

    function setNativeDownloadVisibility(isVisible: boolean) {
      for (const elButton of document.querySelectorAll<HTMLElement>("ytd-download-button-renderer")) {
        elButton.style.display = isVisible ? "" : "none";
      }
    }

    // ─── Panel mounting ─────────────────────────────────────────────────

    async function mountPanelUi(contentId: string) {
      cleanupPanelUi();

      if (!currentVideoData) {
        return;
      }

      const elContent = document.getElementById(contentId);
      if (!elContent) {
        return;
      }

      const ui = createIntegratedUi(context, {
        position: "inline",
        anchor: elContent,
        onMount(elUiContainer) {
          currentPanelSvelteInstance = mount(DownloadOptionsPanel, {
            target: elUiContainer,
            props: { videoData: currentVideoData!, options: currentOptions }
          });
        }
      });

      ui.mount();
    }

    // ─── Playlist page injection ────────────────────────────────────────

    async function injectPlaylistDownloaderUi() {
      cleanupPlaylistUi();

      const elHeader = document.querySelector(
        "ytd-playlist-header-renderer, ytd-playlist-sidebar-primary-info-renderer"
      );
      if (!elHeader) {
        return;
      }

      const elMountContainer = document.createElement("div");
      elMountContainer.setAttribute("data-ytdl-playlist-downloader", "true");
      elHeader.append(elMountContainer);

      const ui = await createShadowRootUi(context, {
        name: "ytdl-playlist-downloader",
        position: "inline",
        anchor: elMountContainer,
        onMount(elUiContainer) {
          currentPlaylistUi = mount(PlaylistDownloader, {
            target: elUiContainer,
            props: { options: currentOptions }
          });
        }
      });

      ui.mount();
    }

    async function injectPlaylistVideoItemUi(elVideoItem: Element) {
      const elVideoIdLink = elVideoItem.querySelector<HTMLAnchorElement>("a#video-title");
      if (!elVideoIdLink) {
        return;
      }

      const videoId = new URLSearchParams(new URL(elVideoIdLink.href).search).get("v");
      if (!videoId || elVideoItem.querySelector(`[data-ytdl-item="${videoId}"]`)) {
        return;
      }

      const elMenu = elVideoItem.querySelector("ytd-menu-renderer");
      if (!elMenu) {
        return;
      }

      const elItemContainer = document.createElement("div");
      elItemContainer.setAttribute("data-ytdl-item", videoId);
      elMenu.append(elItemContainer);

      const ui = await createShadowRootUi(context, {
        name: `ytdl-playlist-item-${videoId}`,
        position: "inline",
        anchor: elItemContainer,
        onMount(elUiContainer) {
          mount(PlaylistVideoItem, {
            target: elUiContainer,
            props: { videoId, options: currentOptions }
          });
        }
      });

      ui.mount();
    }

    async function handlePlaylistVideoAdditions() {
      const elContents = document.querySelector("ytd-playlist-video-list-renderer #contents");
      if (!elContents) {
        return;
      }

      for (const elVideoItem of elContents.querySelectorAll("ytd-playlist-video-renderer")) {
        await injectPlaylistVideoItemUi(elVideoItem);
      }

      const mutationObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node instanceof HTMLElement && node.tagName.toLowerCase() === "ytd-playlist-video-renderer") {
              injectPlaylistVideoItemUi(node);
            }
          }
        }
      });

      mutationObserver.observe(elContents, { childList: true });
      context.onInvalidated(() => mutationObserver.disconnect());
    }

    // ─── Video grid injection (homepage, subscriptions, channel) ────────

    function extractVideoIdFromLockup(elLockup: Element) {
      const contentIdClass = [...elLockup.classList].find(cls => cls.startsWith("content-id-"));
      if (contentIdClass) {
        return contentIdClass.replace("content-id-", "");
      }

      const elLink = elLockup.querySelector<HTMLAnchorElement>("a[href*=\"/watch\"]");
      if (!elLink) {
        return null;
      }

      try {
        return new URLSearchParams(new URL(elLink.href).search).get("v");
      } catch {
        return null;
      }
    }

    async function injectGridVideoButton(elLockup: Element) {
      const videoId = extractVideoIdFromLockup(elLockup);
      if (!videoId || elLockup.querySelector(`[data-ytdl-grid-item="${videoId}"]`)) {
        return;
      }

      const elMenuContainer = elLockup.querySelector(".yt-lockup-metadata-view-model__menu-button");
      if (!elMenuContainer) {
        return;
      }

      const elItemContainer = document.createElement("div");
      elItemContainer.setAttribute("data-ytdl-grid-item", videoId);
      elMenuContainer.insertAdjacentElement("beforebegin", elItemContainer);

      const ui = await createShadowRootUi(context, {
        name: `ytdl-grid-item-${videoId}`,
        position: "inline",
        anchor: elItemContainer,
        onMount(elUiContainer) {
          mount(PlaylistVideoItem, {
            target: elUiContainer,
            props: { videoId, options: currentOptions }
          });
        }
      });

      ui.mount();
    }

    function injectGridVideoButtons() {
      for (const elLockup of document.querySelectorAll("yt-lockup-view-model")) {
        injectGridVideoButton(elLockup);
      }

      gridObserver?.disconnect();
      gridObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) {
              continue;
            }

            const lockups = node.matches("yt-lockup-view-model")
              ? [node]
              : [...node.querySelectorAll("yt-lockup-view-model")];

            for (const elLockup of lockups) {
              injectGridVideoButton(elLockup);
            }
          }
        }
      });

      const elPageContent = document.querySelector("ytd-page-manager") ?? document.body;
      gridObserver.observe(elPageContent, { childList: true, subtree: true });
      context.onInvalidated(() => gridObserver?.disconnect());
    }

    // ─── Navigation routing ─────────────────────────────────────────────

    function isVideoGridPage(pathname: string) {
      return pathname === "/"
        || pathname.startsWith("/feed/")
        || pathname.startsWith("/@");
    }

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
        await injectPlaylistDownloaderUi();
        await handlePlaylistVideoAdditions();
        return;
      }

      if (isVideoGridPage(pathname)) {
        cleanupPanelUi();
        cleanupPlaylistUi();
        setNativeDownloadVisibility(true);
        injectGridVideoButtons();
        return;
      }

      cleanupPanelUi();
      cleanupPlaylistUi();
      cleanupGridUi();
      setNativeDownloadVisibility(true);
    }

    // ─── Message bridging ───────────────────────────────────────────────

    crossWorldMessenger.onMessage("videoData", async ({ data }) => {
      if (location.pathname === "/watch") {
        const urlVideoId = new URLSearchParams(location.search).get("v");
        if (data.videoId === urlVideoId) {
          currentVideoData = data;
        }
      }

      await checkInterruptedDownload(data.videoId);
    });

    crossWorldMessenger.onMessage("navigation", async ({ data }) => {
      currentVideoData = null;
      await handlePageChange(data.url);
      forwardSabrCredentialsWithRetry();
    });

    crossWorldMessenger.onMessage("panelContentReady", async ({ data }) => {
      await mountPanelUi(data.contentId);
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
    });

    // ─── Event listeners ────────────────────────────────────────────────

    addEventListener("ytdl:stream-data", handleStreamData);
    context.onInvalidated(() => removeEventListener("ytdl:stream-data", handleStreamData));

    addEventListener("ytdl:stream-error", handleStreamError);
    context.onInvalidated(() => removeEventListener("ytdl:stream-error", handleStreamError));

    listenForInterruptedDownloadEvents();
    listenForSabrBodyReady();
    forwardSabrCredentialsWithRetry();

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
