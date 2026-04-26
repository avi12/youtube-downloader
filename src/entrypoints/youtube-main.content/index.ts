import { registerGridDropdownHandlers } from "./grid/grid-dropdown";
import { registerGridTagger } from "./grid/grid-tagger";
import { registerGridVideoDataHandler } from "./grid/grid-video-data";
import { runScrubSelfDrive, runTrustFactoryDrive } from "./scrub-self-drive";
import { cancelActiveDownload, performDownload } from "./video/download";
import { extractPlaylistMetadata, handleNavigateSuccess } from "./video/playlist-metadata";
import { extractAndDispatchVideoData } from "./video/video-data";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { type PlayerResponse } from "@/types";

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
    // Scrub iframes hosted in the BG/offscreen page self-drive their capture +
    // report and skip every other extension behavior. We can't gate on
    // `self === top` here because the iframe's top is the BG document, not
    // the iframe itself; gating on the URL parameter (which only this frame's
    // own URL carries) is enough to keep nested YouTube ad/preview iframes
    // out of this branch.
    if (location.search.includes("ytdlScrubMode=1")) {
      // Boot probe: post directly to parent so we can confirm MAIN-world
      // injection happened in a BG-hosted iframe even before the player
      // is ready (independent of the cross-world messenger path).
      try {
        if (parent !== self) {
          parent.postMessage({
            type: "ytdl:scrub-debug",
            msg: `[ytdl:scrub-tab] MAIN booted url=${location.search.slice(0, 120)}`
          }, "*");
        }
      } catch {
        // best-effort
      }

      await runScrubSelfDrive();
      return;
    }

    // Trust-factory iframes (spawned by BG to capture a player-signed SABR
    // template) play through any pre-roll ad at 16x and then idle. BG removes
    // the iframe once the template has been forwarded via SabrTemplateReady.
    if (location.search.includes("ytdlTrustFactoryMode=1")) {
      await runTrustFactoryDrive();
      return;
    }

    if (self !== top && !/ytdl=1/.test(location.search)) {
      return;
    }

    // ytdlKeepPlaying=1: keep player alive but PAUSED (no ad preroll).
    // ytdlScrubMode=1: let the player play (muted) so SABR fetches media. The
    //   parent (iframe-scrub) is responsible for ad detection + capture reset,
    //   then pauses the player after the buffer-ahead window has filled.
    // Default (no flag): hard stop the player (used for download iframes).
    const keepPlaying = /ytdlKeepPlaying=1/.test(location.search);
    const isScrubMode = /ytdlScrubMode=1/.test(location.search);
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

          if (keepPlaying && !isScrubMode) {
            elVideo.pause();
          }
        });

        const elPlayer = document.querySelector<HTMLElement & {
          pauseVideo?: () => void;
          stopVideo?: () => void;
        }>("#movie_player");
        if (isScrubMode) {
          return true;
        }

        if (keepPlaying) {
          elPlayer?.pauseVideo?.();
        } else {
          elPlayer?.stopVideo?.();
          elPlayer?.pauseVideo?.();
        }

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
