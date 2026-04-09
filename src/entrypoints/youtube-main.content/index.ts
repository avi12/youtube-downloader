/**
 * MAIN world content script - runs in the page's JavaScript context.
 *
 * Responsibilities:
 * 1. Read window.ytInitialPlayerResponse and process streaming URLs
 * 2. Inject a segmented download button group into the action bar using
 *    YouTube's native yt-button-view-model elements so they look identical
 *    to YouTube's own buttons (including tooltips, icons, hover states)
 * 3. Relay data and events to/from the isolated world via crossWorldMessenger
 */

import { cancelActiveDownload, performDownload } from "./download";
import { registerGridDropdownHandlers } from "./grid-dropdown";
import { registerGridVideoDataHandler } from "./grid-video-data";
import { handleNavigateSuccess } from "./playlist-metadata";
import { extractAndDispatchVideoData } from "./video-data";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { buttonClickSignal } from "@/lib/synced-stores.svelte";
import { type PlayerResponse } from "@/types";

declare global {
  interface Window {
    ytInitialPlayerResponse?: PlayerResponse;
    ytInitialData?: {
      header?: { playlistHeaderRenderer?: {
        title?: { simpleText?: string };
        playlistId?: string;
      }; };
      metadata?: { playlistMetadataRenderer?: { title?: string } };
    };
  }
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  allFrames: true,
  async main() {
    // Skip non-download iframes (ads, embeds)
    if (self !== top && !location.search.includes("ytdl=1")) {
      return;
    }

    // In download iframes, mute any video that appears - the iframe is for data
    // fetching only and must never play audio
    if (self !== top) {
      function muteVideo() {
        const elVideo = document.querySelector<HTMLVideoElement>("video");
        if (elVideo) {
          elVideo.muted = true;
        }
      }
      muteVideo();
      new MutationObserver(muteVideo).observe(document.documentElement, { childList: true, subtree: true });
    }

    // Handle download requests from Svelte panel components (via isolated world)
    crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
      void performDownload(data);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
      for (const videoId of data.videoIds) {
        cancelActiveDownload(videoId);
      }
    });

    // SetButtonData/ButtonClick bridge: sets Polymer button data from isolated world
    // and relays click events back via crossWorldMessenger
    crossWorldMessenger.onMessage(CrossWorldMessage.SetButtonData, ({ data: { selector, data: buttonData } }) => {
      const elButton = document.querySelector<HTMLElement>(selector);
      if (!elButton || !("data" in elButton)) {
        return;
      }

      elButton.data = buttonData;

      if (elButton.hasAttribute("data-ytdl-click-bound")) {
        return;
      }

      elButton.setAttribute("data-ytdl-click-bound", "true");
      elButton.addEventListener("click", e => {
        e.stopPropagation();
        const buttonId = elButton.getAttribute("data-ytdl-button-id");
        if (buttonId) {
          buttonClickSignal.value = { buttonId };
        }
      });
    });

    registerGridDropdownHandlers();
    registerGridVideoDataHandler();

    document.addEventListener("yt-navigate-finish", handleNavigateSuccess);

    if (document.readyState === "complete") {
      await extractAndDispatchVideoData(cancelActiveDownload);
    } else {
      addEventListener("load", () => extractAndDispatchVideoData(cancelActiveDownload), { once: true });
    }
  }
});
