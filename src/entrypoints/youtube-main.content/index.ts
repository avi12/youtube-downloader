import { registerGridDropdownHandlers } from "./grid/grid-dropdown";
import { registerGridTagger } from "./grid/grid-tagger";
import { registerGridVideoDataHandler } from "./grid/grid-video-data";
import { cancelActiveDownload, performDownload } from "./video/download";
import { extractPlaylistMetadata, handleNavigateSuccess } from "./video/playlist-metadata";
import { extractAndDispatchVideoData } from "./video/video-data";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import { DATA_BUTTON_ID_ATTR } from "@/lib/ui/polymer-utils";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { getMoviePlayer } from "@/lib/youtube/movie-player";
import { ProgressType, type PlayerResponse } from "@/types";

declare global {
  interface Window {
    ytInitialPlayerResponse?: PlayerResponse;
    ytInitialData?: {
      header?: {
        playlistHeaderRenderer?: {
          title?: {
            simpleText?: string;
          };
          playlistId?: string;
          ownerText?: {
            runs?: Array<{ text?: string }>;
          };
        };
      };
      metadata?: {
        playlistMetadataRenderer?: {
          title?: string;
        };
      };
    };
  }
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  allFrames: true,
  async main() {
    if (self !== top && !/ytdl=1/.test(location.search)) {
      return;
    }

    // Download iframes are for data fetching only and must never play audio or video.
    if (self !== top) {
      function silenceIframeVideo() {
        const elVideo = document.querySelector<HTMLVideoElement>("video");
        if (!elVideo) {
          return false;
        }

        elVideo.muted = true;
        elVideo.volume = 0;
        elVideo.addEventListener("play", () => {
          elVideo.muted = true;
          elVideo.volume = 0;
        });

        const elPlayer = getMoviePlayer();
        elPlayer?.stopVideo?.();
        elPlayer?.pauseVideo?.();
        return true;
      }

      if (!silenceIframeVideo()) {
        const silenceObserver = new MutationObserver((_, observer) => {
          if (silenceIframeVideo()) {
            observer.disconnect();
          }
        });
        silenceObserver.observe(document.documentElement, CHILD_LIST_SUBTREE);
      }
    }

    // Handle download requests from Svelte panel components (via isolated world)
    crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
      void performDownload(data);
    });

    crossWorldMessenger.onMessage(CrossWorldMessage.CancelDownload, ({ data }) => {
      for (const videoId of data.videoIds) {
        cancelActiveDownload(videoId);
        emitCrossWorldEvent({
          type: CrossWorldEvent.ProgressUpdate,
          data: {
            videoId,
            progress: 0,
            progressType: ProgressType.Video,
            isRemoved: true
          }
        });
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
      const buttonId = elButton.getAttribute(DATA_BUTTON_ID_ATTR);
      if (buttonId) {
        buttonIdByElement.set(elButton, buttonId);
      }

      elButton.data = buttonData;

      // Polymer just stripped the attribute as part of its render. Restore it
      // so subsequent SetButtonData lookups (e.g. when the primary button
      // morphs from Download → Cancel) can still find this element by selector.
      const cachedId = buttonIdByElement.get(elButton);
      if (cachedId && elButton.getAttribute(DATA_BUTTON_ID_ATTR) !== cachedId) {
        elButton.setAttribute(DATA_BUTTON_ID_ATTR, cachedId);
      }

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
    registerGridTagger();
    registerGridVideoDataHandler();

    document.addEventListener("yt-navigate-finish", handleNavigateSuccess);

    if (document.readyState === "complete") {
      await extractAndDispatchVideoData(cancelActiveDownload);
      extractPlaylistMetadata();
    } else {
      addEventListener("load", () => {
        void extractAndDispatchVideoData(cancelActiveDownload);
        extractPlaylistMetadata();
      }, { once: true });
    }
  }
});
