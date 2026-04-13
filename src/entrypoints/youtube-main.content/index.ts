import { cancelActiveDownload, performDownload } from "./download";
import { registerGridDropdownHandlers } from "./grid-dropdown";
import { registerGridVideoDataHandler } from "./grid-video-data";
import { handleNavigateSuccess } from "./playlist-metadata";
import { extractAndDispatchVideoData } from "./video-data";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/cross-world-messenger";
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
    if (self !== top && !location.search.includes("ytdl=1")) {
      return;
    }

    // Download iframes are for data fetching only and must never play audio or video.
    if (self !== top) {
      const muteAndPauseObserver = new MutationObserver((_, observer) => {
        const elVideo = document.querySelector<HTMLVideoElement>("video");
        if (!elVideo) {
          return;
        }

        elVideo.muted = true;
        elVideo.pause();
        const elPlayer = document.querySelector<HTMLElement & { pauseVideo?: () => void }>("#movie_player");
        elPlayer?.pauseVideo?.();
        observer.disconnect();
      });
      muteAndPauseObserver.observe(document.documentElement, { childList: true, subtree: true });
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

    // Track the latest buttonId per element so click handlers dispatch the current ID
    // even after Polymer strips the data attribute.
    const buttonIdByElement = new WeakMap<HTMLElement, string>();

    crossWorldMessenger.onMessage(CrossWorldMessage.SetButtonData, ({ data: { selector, data: buttonData } }) => {
      const elButton = document.querySelector<HTMLElement>(selector);
      if (!elButton || !("data" in elButton)) {
        return;
      }

      // Polymer's render cycle strips non-registered attributes, so capture buttonId before setting .data.
      const buttonId = elButton.getAttribute("data-ytdl-button-id");
      if (buttonId) {
        buttonIdByElement.set(elButton, buttonId);
      }

      elButton.data = buttonData;

      if (elButton.hasAttribute("data-ytdl-click-bound")) {
        return;
      }

      elButton.setAttribute("data-ytdl-click-bound", "true");
      elButton.addEventListener("click", e => {
        const currentButtonId = buttonIdByElement.get(elButton);
        if (currentButtonId) {
          e.stopPropagation();
          dispatchButtonClick(currentButtonId);
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
