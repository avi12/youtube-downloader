import { registerGridDropdownHandlers } from "./grid/grid-dropdown";
import { registerGridTagger } from "./grid/grid-tagger";
import { registerGridVideoDataHandler } from "./grid/grid-video-data";
import { cancelActiveDownload, cancelAllActiveDownloads, performDownload } from "./video/download";
import { extractPlaylistMetadata, handleNavigateSuccess } from "./video/playlist-metadata";
import { extractAndDispatchVideoData } from "./video/video-data";
import { CrossWorldEvent, emitCrossWorldEvent } from "@/lib/messaging/cross-world-events";
import { CrossWorldMessage, crossWorldMessenger, dispatchButtonClick } from "@/lib/messaging/cross-world-messenger";
import { DATA_BUTTON_ID_ATTR, isYtFormattedString, setFormattedStringText } from "@/lib/ui/polymer-utils";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import {
  ACTIVE_CAPTION_ATTR,
  capturePlayerCaptionBus,
  getMoviePlayer,
  isPlayerCaptionTrackData
} from "@/lib/youtube/movie-player";
import {
  ButtonSize,
  ButtonState,
  ButtonStyle,
  ButtonType,
  ProgressType,
  type PlayerResponse
} from "@/types";

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

    const SNACKBAR_VIEW_BUTTON_ID = "ytdl-snackbar-view";

    crossWorldMessenger.onMessage(CrossWorldMessage.OpenSnackbar, () => {
      requestAnimationFrame(() => {
        const elViewBtn = document.querySelector<HTMLElement>(`[${DATA_BUTTON_ID_ATTR}="${SNACKBAR_VIEW_BUTTON_ID}"]`);
        if (!elViewBtn || !("data" in elViewBtn)) {
          return;
        }

        elViewBtn.data = {
          title: "View",
          accessibilityText: "View in folder",
          style: ButtonStyle.CallToAction,
          type: ButtonType.Text,
          buttonSize: ButtonSize.XSmall,
          state: ButtonState.Active,
          isFullWidth: false,
          isDisabled: false,
          tooltip: ""
        };

        // Polymer maps CallToAction to ytSpecButtonShapeNextMono; swap to the
        // inverse variant so YouTube's snackbar CSS applies the correct blue.
        queueMicrotask(() => {
          const elInner = elViewBtn.querySelector("button");
          if (elInner) {
            elInner.classList.replace("ytSpecButtonShapeNextMono", "ytSpecButtonShapeNextCallToActionInverse");
          }
        });

        elViewBtn.addEventListener("click", () => dispatchButtonClick(SNACKBAR_VIEW_BUTTON_ID));
      });
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

    crossWorldMessenger.onMessage(CrossWorldMessage.SetButtonData, ({ data: { selector, data: buttonData, a11y } }) => {
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
      const isButtonIdStale = cachedId && elButton.getAttribute(DATA_BUTTON_ID_ATTR) !== cachedId;
      if (isButtonIdStale) {
        elButton.setAttribute(DATA_BUTTON_ID_ATTR, cachedId);
      }

      if (a11y) {
        queueMicrotask(() => {
          const elInner = elButton.querySelector("button");
          if (!elInner) {
            return;
          }

          elInner.tabIndex = a11y.tabIndex;
          elInner.setAttribute("role", a11y.role);
          elInner.setAttribute("aria-checked", a11y.ariaChecked);
        });
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

    crossWorldMessenger.onMessage(CrossWorldMessage.SetFormattedStringText, ({ data: { selector, text } }) => {
      const elFmtStr = document.querySelector(selector);
      if (!elFmtStr || !isYtFormattedString(elFmtStr)) {
        return;
      }

      setFormattedStringText(elFmtStr, text);
    });

    registerGridDropdownHandlers();
    registerGridTagger();
    registerGridVideoDataHandler();

    function setupAudioTrackWatcher() {
      const player = getMoviePlayer();
      if (!player?.getOption || player.__ytdlAudioWatched) {
        return;
      }

      const bus = capturePlayerCaptionBus(player);
      if (!bus) {
        return;
      }

      player.__ytdlAudioWatched = true;

      bus.subscribe("internalaudioformatchange", (trackId: unknown) => {
        if (typeof trackId === "string" && trackId) {
          void crossWorldMessenger.sendMessage(CrossWorldMessage.AudioTrackChanged, { trackId });
        }
      });
    }

    function writeCaptionAttr(languageCode: string, vssId: string) {
      getMoviePlayer()?.setAttribute(
        ACTIVE_CAPTION_ATTR, JSON.stringify({
          languageCode,
          vss_id: vssId
        })
      );
    }

    function setupCaptionTrackWatcher() {
      const player = getMoviePlayer();
      if (!player?.getOption || player.__ytdlCaptionWatched) {
        return;
      }

      player.__ytdlCaptionWatched = true;

      function onCaptionTrack(languageCode: string, vssId: string) {
        writeCaptionAttr(languageCode, vssId);
        void crossWorldMessenger.sendMessage(CrossWorldMessage.CaptionTrackChanged, {
          languageCode,
          vssId
        });
      }

      function syncCaptionFromPlayer() {
        const track = player?.getOption?.("captions", "track");
        if (isPlayerCaptionTrackData(track)) {
          onCaptionTrack(track.languageCode, track.vss_id);
        }
      }

      syncCaptionFromPlayer();
      // YouTube restores the saved caption on initial load before any bus events fire.
      document.querySelector("video")?.addEventListener("playing", syncCaptionFromPlayer, { once: true });

      const bus = capturePlayerCaptionBus(player);
      if (!bus) {
        return;
      }

      bus.subscribe("captionschanged", (trackData: unknown) => {
        if (isPlayerCaptionTrackData(trackData)) {
          onCaptionTrack(trackData.languageCode, trackData.vss_id);
        }
      });
    }

    document.addEventListener("yt-navigate-finish", handleNavigateSuccess);
    document.addEventListener("yt-navigate-finish", setupAudioTrackWatcher);
    document.addEventListener("yt-navigate-finish", setupCaptionTrackWatcher);

    if (self === top) {
      function cancelAllAndNotify() {
        const videoIds = cancelAllActiveDownloads();
        if (videoIds.length > 0) {
          void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds });
        }
      }

      document.addEventListener("yt-navigate-start", cancelAllAndNotify);
      addEventListener("pagehide", cancelAllAndNotify);
    }

    async function initializeOnLoad() {
      await extractAndDispatchVideoData();
      extractPlaylistMetadata();
      setupAudioTrackWatcher();
      setupCaptionTrackWatcher();
    }

    if (document.readyState === "complete") {
      void initializeOnLoad();
    } else {
      addEventListener("load", () => void initializeOnLoad(), { once: true });
    }
  }
});
