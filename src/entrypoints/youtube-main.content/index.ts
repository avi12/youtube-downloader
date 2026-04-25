import { registerGridDropdownHandlers } from "./grid/grid-dropdown";
import { registerGridTagger } from "./grid/grid-tagger";
import { registerGridVideoDataHandler } from "./grid/grid-video-data";
import { runScrubSelfDrive, runTrustFactoryDrive } from "./scrub-self-drive";
import { capturedPoToken } from "./video/credentials";
import { cancelActiveDownload, performDownload } from "./video/download";
import { extractPlaylistMetadata, handleNavigateSuccess } from "./video/playlist-metadata";
import { extractAndDispatchVideoData, videoDataCache } from "./video/video-data";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { debugRangedSabr } from "@/lib/youtube/sabr-download";
import { type PlayerResponse } from "@/types";

declare global {
  interface Window {
    __ytdlDebug?: {
      injectIframe(videoId: string, startSec?: number): string;
      runSabrInContext(videoId: string, fromMs: number, runMs?: number): Promise<unknown>;
      inspectCapture(): unknown;
      harvestIframeCapture(videoId: string): unknown;
      removeIframe(videoId: string): boolean;
    };
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

    // Debug hook: let RDP eval drive the iframe-context SABR experiment.
    // __ytdlDebug.injectIframe(id) appends a hidden iframe that loads the watch
    // page with ytdl=1 (same matcher our iframe-scoped content scripts use).
    // __ytdlDebug.runSabrInContext(id, fromMs) runs debugRangedSabr with
    // window.fetch as fetchFn so the request inherits this frame's live-player
    // session state — test whether that gets past attestation where background
    // fetches don't.
    window.__ytdlDebug = {
      injectIframe(videoId: string, startSec = 0) {
        const existing = document.querySelector<HTMLIFrameElement>(`iframe[data-ytdl-debug-frame="${videoId}"]`);
        if (existing) {
          existing.remove();
        }

        const elFrame = document.createElement("iframe");
        elFrame.dataset.ytdlDebugFrame = videoId;
        // &t=N makes YouTube's player initialize at timestamp N — its first
        // SABR request goes out with playerTimeMs=N*1000, in a fresh live-
        // player session carrying real attestation signals. ytdlKeepPlaying=1
        // tells our iframe setup (below, self!==top branch) to skip the
        // stopVideo/pauseVideo calls so the player actually buffers.
        const hasStart = startSec > 0 ? `&t=${startSec}` : "";
        elFrame.src = `https://www.youtube.com/watch?v=${videoId}&ytdl=1&ytdlKeepPlaying=1${hasStart}`;
        elFrame.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;opacity:0;pointer-events:none";
        document.body.append(elFrame);
        return elFrame.src;
      },
      // Read iframe's capture summary WITHOUT mutating state — use for polling
      // while the iframe's player is buffering. Caller in the parent accesses
      // iframeEl.contentWindow.__ytdlDebug.inspectCapture() to look in.
      harvestIframeCapture(videoId: string) {
        const iframe = document.querySelector<HTMLIFrameElement>(`iframe[data-ytdl-debug-frame="${videoId}"]`);
        type IframeWindow = Window & { __ytdlCapture?: typeof window.__ytdlCapture };
        const iframeWindow: IframeWindow | null = iframe?.contentWindow ?? null;
        const capture = iframeWindow?.__ytdlCapture;
        if (!capture) {
          return { error: "no iframe capture" };
        }

        const media = capture.capturedMedia.get(videoId);
        if (!media) {
          return {
            videoId,
            videoChunks: 0,
            audioChunks: 0,
            videoBytes: 0,
            audioBytes: 0
          };
        }

        return {
          videoId,
          videoChunks: media.videoChunks.length,
          audioChunks: media.audioChunks.length,
          videoBytes: media.videoTotalBytes,
          audioBytes: media.audioTotalBytes,
          videoMimeType: media.videoMimeType,
          audioMimeType: media.audioMimeType
        };
      },
      removeIframe(videoId: string) {
        const iframe = document.querySelector<HTMLIFrameElement>(`iframe[data-ytdl-debug-frame="${videoId}"]`);
        if (iframe) {
          iframe.remove();
          return true;
        }

        return false;
      },
      inspectCapture() {
        const capture = window.__ytdlCapture;
        if (!capture) {
          return { error: "no capture state" };
        }

        const byId: Record<string, {
          videoChunks: number;
          videoBytes: number;
          audioChunks: number;
          audioBytes: number;
        }> = {};
        for (const [videoId, media] of capture.capturedMedia.entries()) {
          byId[videoId] = {
            videoChunks: media.videoChunks.length,
            videoBytes: media.videoTotalBytes,
            audioChunks: media.audioChunks.length,
            audioBytes: media.audioTotalBytes
          };
        }
        return {
          activeVideoId: capture.activeVideoId,
          pending: capture.pendingChunks.length,
          byVideo: byId
        };
      },
      async runSabrInContext(videoId: string, fromMs: number, runMs = 30000) {
        const cachedVideoData = videoDataCache.get(videoId);
        if (!cachedVideoData?.sabrConfig) {
          return {
            error: "no sabrConfig",
            videoId,
            haveVideoData: Boolean(cachedVideoData)
          };
        }

        const videoFormat = cachedVideoData.videoFormats[0];
        const audioFormat = cachedVideoData.audioFormats[0];
        if (!videoFormat || !audioFormat) {
          return { error: "no formats" };
        }

        return debugRangedSabr({
          sabrConfig: cachedVideoData.sabrConfig,
          videoFormat,
          audioFormat,
          fetchFn: window.fetch.bind(window),
          poToken: capturedPoToken,
          fromMs,
          runMs
        });
      }
    };

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
