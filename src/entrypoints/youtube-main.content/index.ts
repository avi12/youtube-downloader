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

import { registerDirectDownloadHandler } from "./direct-download";
import { cancelActiveDownload, performDownload } from "./download";
import { registerGridDropdownHandlers } from "./grid-dropdown";
import { registerGridVideoDataHandler } from "./grid-video-data";
import { handleNavigateSuccess } from "./playlist-metadata";
import { extractAndDispatchVideoData } from "./video-data";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { SYNC_NAMESPACE, SyncKey } from "@/lib/synced-stores.svelte";
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

    // Handle download requests from Svelte panel components (via isolated world)
    crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, async ({ data }) => {
      await performDownload(data);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
      for (const videoId of data.videoIds) {
        cancelActiveDownload(videoId);
      }
    });

    // SetButtonData/ButtonClick bridge: sets Polymer button data from isolated world
    // and relays click events back via postMessage
    addEventListener("message", e => {
      if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.SetButtonData) {
        return;
      }

      const { selector, data: buttonData } = e.data.value ?? {};
      const elButton = document.querySelector<HTMLElement>(selector);
      if (!elButton || !("data" in elButton)) {
        return;
      }

      elButton.data = buttonData;

      if (!elButton.hasAttribute("data-ytdl-click-bound")) {
        elButton.setAttribute("data-ytdl-click-bound", "true");
        elButton.addEventListener("click", clickEvent => {
          clickEvent.stopPropagation();
          const buttonId = elButton.getAttribute("data-ytdl-button-id");
          if (buttonId) {
            postMessage({
              namespace: SYNC_NAMESPACE,
              key: SyncKey.ButtonClick,
              value: { buttonId }
            }, location.origin);
          }
        });
      }
    });

    registerGridDropdownHandlers();
    registerGridVideoDataHandler();
    registerDirectDownloadHandler();

    navigation.addEventListener("navigatesuccess", handleNavigateSuccess);

    if (document.readyState === "complete") {
      await extractAndDispatchVideoData(cancelActiveDownload);
    } else {
      addEventListener("load", () => extractAndDispatchVideoData(cancelActiveDownload), { once: true });
    }
  }
});
