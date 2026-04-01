/**
 * Isolated world content script - handles extension messaging and UI injection.
 *
 * This script:
 * - Bridges download requests from Svelte components to the background
 * - Forwards progress updates from background back to all contexts via pageMessenger
 * - Mounts DownloadOptionsPanel.svelte on /watch pages when the chevron is clicked
 * - Mounts Svelte UI for playlist pages
 */

import DownloadOptionsPanel from "@/components/DownloadOptionsPanel.svelte";
import PlaylistDownloader from "@/components/PlaylistDownloader.svelte";
import PlaylistVideoItem from "@/components/PlaylistVideoItem.svelte";
import { sendMessage, onMessage } from "@/lib/messaging";
import { pageMessenger } from "@/lib/page-messenger";
import { optionsItem } from "@/lib/storage";
import type { Options, VideoData } from "@/types";
import { mount, unmount } from "svelte";

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  cssInjectionMode: "ui",
  async main(context) {
    localStorage.setItem("ytdl_cs_version", String(Date.now()));
    // Inject component styles into the page for createIntegratedUi
    // (createIntegratedUi does not auto-inject CSS unlike createShadowRootUi)
    const elStyleLink = document.createElement("link");
    elStyleLink.rel = "stylesheet";
    elStyleLink.href = browser.runtime.getURL("/content-scripts/youtube.css");
    document.head.append(elStyleLink);
    context.onInvalidated(() => elStyleLink.remove());

    // - State -

    let currentPlaylistUi: ReturnType<typeof mount> | null = null;
    let currentPanelSvelteInstance: ReturnType<typeof mount> | null = null;
    let currentOptions: Options = await optionsItem.getValue();
    let currentVideoData: VideoData | null = null;

    // - Cleanup helpers -

    function cleanupPlaylistUi() {
      if (!currentPlaylistUi) {
        return;
      }

      unmount(currentPlaylistUi);
      currentPlaylistUi = null;
      document
        .querySelectorAll("[data-ytdl-playlist-downloader]")
        .forEach(element => element.remove());
    }

    // The dropdown DOM is owned by the MAIN world; isolated world only manages
    // the Svelte instance mounted inside it.
    function cleanupPanelUi() {
      if (!currentPanelSvelteInstance) {
        return;
      }

      unmount(currentPanelSvelteInstance);
      currentPanelSvelteInstance = null;
    }

    // - Native "..." menu download button visibility -

    function setNativeDownloadVisibility(isVisible: boolean) {
      document.querySelectorAll<HTMLElement>("ytd-download-button-renderer").forEach(
        element => {
          element.style.display = isVisible ? "" : "none";
        }
      );
    }

    // - Options panel mounting -
    // Mounts the Svelte panel into the tp-yt-iron-dropdown slot created by
    // the MAIN world. Svelte stays mounted until navigation so state is
    // preserved across panel open/close cycles.

    async function mountPanelUi(contentId: string) {
      cleanupPanelUi();

      if (!currentVideoData) {
        return;
      }

      const elContent = document.getElementById(contentId);
      if (!elContent) {
        return;
      }

      // createIntegratedUi mounts directly into the page DOM (no shadow root),
      // so YouTube's existing stylesheets apply to yt-spec-button-shape-next
      // buttons without any adoption or injection.
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

    // - Playlist page UI injection -

    async function injectPlaylistDownloaderUi() {
      cleanupPlaylistUi();

      const PLAYLIST_HEADER_SELECTORS = [
        "ytd-playlist-header-renderer",
        "ytd-playlist-sidebar-primary-info-renderer"
      ];

      let elHeader: Element | null = null;
      for (const selector of PLAYLIST_HEADER_SELECTORS) {
        elHeader = document.querySelector(selector);

        if (elHeader) {
          break;
        }
      }

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

    async function handlePlaylistVideoAdditions() {
      const PLAYLIST_CONTENTS_SELECTOR = "ytd-playlist-video-list-renderer #contents";
      const elContents = document.querySelector(PLAYLIST_CONTENTS_SELECTOR);
      if (!elContents) {
        return;
      }

      const videoItems = elContents.querySelectorAll("ytd-playlist-video-renderer");
      for (const elVideoItem of videoItems) {
        await injectPlaylistVideoItemUi(elVideoItem);
      }

      const mutationObserver = new MutationObserver(mutations => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (
              node instanceof HTMLElement &&
              node.tagName.toLowerCase() === "ytd-playlist-video-renderer"
            ) {
              injectPlaylistVideoItemUi(node);
            }
          });
        });
      });

      mutationObserver.observe(elContents, { childList: true });
      context.onInvalidated(() => mutationObserver.disconnect());
    }

    async function injectPlaylistVideoItemUi(elVideoItem: Element) {
      const elVideoIdLink = elVideoItem.querySelector<HTMLAnchorElement>("a#video-title");
      if (!elVideoIdLink) {
        return;
      }

      const videoUrl = elVideoIdLink.href;
      const videoId = new URLSearchParams(new URL(videoUrl).search).get("v");
      if (!videoId) {
        return;
      }

      if (elVideoItem.querySelector(`[data-ytdl-item="${videoId}"]`)) {
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

    // - Navigation handler -

    async function handlePageChange(url: string) {
      const { pathname } = new URL(url);
      if (pathname === "/watch") {
        cleanupPlaylistUi();
        cleanupPanelUi();
        setNativeDownloadVisibility(!currentOptions.isRemoveNativeDownload);
      } else if (pathname === "/playlist") {
        cleanupPanelUi();
        setNativeDownloadVisibility(true);
        await injectPlaylistDownloaderUi();
        await handlePlaylistVideoAdditions();
      } else {
        cleanupPanelUi();
        cleanupPlaylistUi();
        setNativeDownloadVisibility(true);
      }
    }

    // - pageMessenger event listeners -

    // Receive video data from MAIN world - store for panel use
    const unsubscribeVideoData = pageMessenger.onMessage("videoData", async ({ data }) => {
      if (location.pathname !== "/watch") {
        return;
      }

      const urlVideoId = new URLSearchParams(location.search).get("v");
      if (data.videoId !== urlVideoId) {
        return;
      }

      currentVideoData = data;

      // Check for interrupted download and expose to MAIN world via DOM
      const interrupted = await sendMessage("getInterruptedDownload", { videoId: data.videoId });
      let elInterrupted = document.getElementById("ytdl-interrupted");
      if (interrupted) {
        if (!elInterrupted) {
          elInterrupted = document.createElement("div");
          elInterrupted.id = "ytdl-interrupted";
          elInterrupted.hidden = true;
          document.documentElement.append(elInterrupted);
        }

        elInterrupted.dataset.videoId = interrupted.videoId;
        elInterrupted.dataset.type = interrupted.type;
        elInterrupted.dataset.filenameOutput = interrupted.filenameOutput;
        elInterrupted.dataset.videoItag = String(interrupted.videoItag);
        elInterrupted.dataset.audioItag = String(interrupted.audioItag);
      } else {
        elInterrupted?.remove();
      }
    });
    context.onInvalidated(unsubscribeVideoData);

    // Receive navigation events from MAIN world
    const unsubscribeNavigation = pageMessenger.onMessage("navigation", async ({ data }) => {
      currentVideoData = null;
      await handlePageChange(data.url);
      // Re-forward SABR credentials for the new page (PO token persists per session)
      forwardSabrCredentialsWithRetry();
    });
    context.onInvalidated(unsubscribeNavigation);

    // MAIN world signals that the tp-yt-iron-dropdown slot is ready - mount Svelte once
    const unsubscribePanelContentReady = pageMessenger.onMessage("panelContentReady", async ({ data }) => {
      await mountPanelUi(data.contentId);
    });
    context.onInvalidated(unsubscribePanelContentReady);

    // When background captures a SABR request body, forward credentials to MAIN world
    let isCredentialsForwarded = false;

    async function forwardSabrCredentials() {
      const captured = await sendMessage("getCapturedSabrBody", {});
      if (!captured?.poToken) {
        return;
      }

      isCredentialsForwarded = true;
      // Store credentials in a hidden DOM element so the MAIN world can read them.
      // CustomEvent.detail and pageMessenger don't reliably cross the
      // isolated/MAIN world boundary in Chrome.
      let elCredentials = document.getElementById("ytdl-sabr-credentials");
      if (!elCredentials) {
        elCredentials = document.createElement("div");
        elCredentials.id = "ytdl-sabr-credentials";
        elCredentials.hidden = true;
        document.documentElement.append(elCredentials);
      }

      elCredentials.dataset.url = captured.url;
      elCredentials.dataset.poToken = captured.poToken;
    }

    // Retry forwarding until credentials are available (SABR requests
    // may arrive after our first attempt, especially on SPA navigation)
    async function forwardSabrCredentialsWithRetry() {
      isCredentialsForwarded = false;

      for (let iAttempt = 0; iAttempt < 30; iAttempt++) {
        await forwardSabrCredentials();

        if (isCredentialsForwarded) {
          return;
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Background notifies when SABR body is first captured for this tab
    onMessage("sabrBodyReady", () => {
      forwardSabrCredentials();
    });

    // Try immediately and retry - SABR data may not be captured yet on initial load
    forwardSabrCredentialsWithRetry();

    // Forward cancel requests from MAIN world button or Svelte components to background
    const unsubscribeCancelDownload = pageMessenger.onMessage("cancelDownload", async ({ data }) => {
      await sendMessage("cancelDownload", { videoIds: data.videoIds });
    });
    context.onInvalidated(unsubscribeCancelDownload);

    // Forward SABR stream data from MAIN world to background for muxing/download.
    // Large Uint8Array (40+ MB) silently fails through runtime.sendMessage as a single
    // message. Split into 1 MB chunks so each hop stays well under Chrome's limit.
    // The receiver (offscreen for Chrome, background for Firefox) reassembles before FFmpeg.
    const TRANSFER_CHUNK_SIZE = 1024 * 1024;

    function uint8ToBase64(bytes: Uint8Array) {
      let binary = "";
      const batchSize = 8192;
      for (let offset = 0; offset < bytes.byteLength; offset += batchSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + batchSize, bytes.byteLength)));
      }

      return btoa(binary);
    }

    async function sendStreamChunks(
      videoId: string,
      streamType: string,
      data: Uint8Array
    ) {
      const totalChunks = Math.ceil(data.byteLength / TRANSFER_CHUNK_SIZE);
      console.log(`[ytdl:cs] sendStreamChunks ${streamType} ${totalChunks} chunks, ${data.byteLength} bytes`);
      for (let iChunk = 0; iChunk < totalChunks; iChunk++) {
        const start = iChunk * TRANSFER_CHUNK_SIZE;
        const chunk = data.slice(start, start + TRANSFER_CHUNK_SIZE);
        const base64 = uint8ToBase64(chunk);
        console.log(`[ytdl:cs] sending chunk ${iChunk + 1}/${totalChunks}, base64 length=${base64.length}`);
        try {
          await sendMessage("streamChunk", {
            videoId,
            streamType,
            iChunk,
            totalChunks,
            chunkBase64: base64
          });
          console.log(`[ytdl:cs] chunk ${iChunk + 1} sent OK`);
        } catch (error) {
          console.error(`[ytdl:cs] chunk ${iChunk + 1} FAILED:`, error);
        }
      }
      console.log(`[ytdl:cs] all ${streamType} chunks sent`);
    }

    async function handleStreamMessage(e: Event) {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      const {
        downloadType, videoId, filenameOutput,
        videoData, audioData, videoMimeType, audioMimeType,
        audioLabel, additionalAudioData
      } = e.detail;
      if (videoData) {
        await sendStreamChunks(videoId, "video", videoData);
      }

      if (audioData) {
        await sendStreamChunks(videoId, "audio", audioData);
      }

      // Send each additional language track under its own stream type key
      const extraAudioStreams: Array<{ data: Uint8Array; label: string }> = additionalAudioData ?? [];
      for (let iTrack = 0; iTrack < extraAudioStreams.length; iTrack++) {
        const track = extraAudioStreams[iTrack];
        if (track.data) {
          await sendStreamChunks(videoId, `audio-extra-${iTrack}`, track.data);
        }
      }

      const audioTrackLabels = [
        audioLabel ?? "",
        ...extraAudioStreams.map(track => track.label)
      ];

      await sendMessage("streamEnd", {
        type: downloadType,
        videoId,
        filenameOutput,
        videoMimeType,
        audioMimeType,
        audioTrackLabels
      });
    }

    addEventListener("ytdl:stream-data", handleStreamMessage);
    context.onInvalidated(() => removeEventListener("ytdl:stream-data", handleStreamMessage));

    async function handleStreamError(e: Event) {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      const { videoId, error }: { videoId: string; error: string } = e.detail;
      await sendMessage("processStreamError", { videoId, error });
    }

    addEventListener("ytdl:stream-error", handleStreamError);
    context.onInvalidated(() => removeEventListener("ytdl:stream-error", handleStreamError));

    // Persist/clear interrupted download state (from MAIN world to background storage)
    document.addEventListener("ytdl:persist-interrupted", async (e: Event) => {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      await sendMessage("persistInterruptedDownload", e.detail);
    });

    document.addEventListener("ytdl:clear-interrupted", async (e: Event) => {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      await sendMessage("clearInterruptedDownload", { videoId: e.detail.videoId });
    });

    // Handle SABR downloads (videos with no direct format URLs).
    // Fetches streams via YouTube's server-side ABR endpoint using the PO token
    // captured from the player's own SABR requests.
    async function handleSabrDownload(e: Event) {
      if (!(e instanceof CustomEvent)) {
        return;
      }

      const { videoId }: { videoId: string } = e.detail;

      try {
        // The SABR fallback is handled by SourceBuffer capture in the MAIN world.
        // If we reach here, the capture didn't have data yet.
        await sendMessage("processStreamError", {
          videoId,
          error: "No media captured yet - let the video play for a moment, then try again"
        });
      } catch (error) {
        console.error("[ytdl] SABR download failed:", videoId, error);
        await sendMessage("processStreamError", {
          videoId,
          error: String(error)
        });
      }
    }

    addEventListener("ytdl:sabr-download", handleSabrDownload);
    context.onInvalidated(() => removeEventListener("ytdl:sabr-download", handleSabrDownload));

    // Trigger a download item dispatched from background (playlist downloads)
    onMessage("executeDownloadItem", ({ data }) => {
      void pageMessenger.sendMessage("downloadRequest", data);
    });

    // Forward progress updates from background to all contexts via pageMessenger
    // (picked up by DownloadOptionsPanel, PlaylistVideoItem, and MAIN world button)
    onMessage("updateDownloadProgress", ({ data }) => {
      void pageMessenger.sendMessage("progress", data);
    });

    // Listen for options changes
    const unwatchOptions = optionsItem.watch(newOptions => {
      if (!newOptions) {
        return;
      }

      currentOptions = newOptions;
      setNativeDownloadVisibility(!currentOptions.isRemoveNativeDownload);
    });
    context.onInvalidated(unwatchOptions);

    // - Initial page handling -

    await handlePageChange(location.href);
  }
});
