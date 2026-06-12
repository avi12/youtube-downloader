import { registerCrossWorldHandlers } from "./cross-world-handlers";
import { registerGridDropdownHandlers } from "./grid/grid-dropdown";
import { registerGridTagger } from "./grid/grid-tagger";
import { registerGridVideoDataHandler } from "./grid/grid-video-data";
import { setupIframeSilencer } from "./iframe-silencer";
import { setupAudioTrackWatcher, setupCaptionTrackWatcher } from "./player-watchers";
import { cancelAllActiveDownloads } from "./video/download";
import { extractPlaylistMetadata, handleNavigateSuccess } from "./video/playlist-metadata";
import { extractAndDispatchVideoData } from "./video/video-data";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { initContentOptions } from "@/lib/ui/synced-stores.svelte";
import type { PlayerResponse } from "@/types";

const YTDL_IFRAME_QUERY_PARAM = "ytdl=1";
const EVENT_YT_NAVIGATE_FINISH = "yt-navigate-finish";
const EVENT_YT_NAVIGATE_START = "yt-navigate-start";
const EVENT_PAGEHIDE = "pagehide";
const EVENT_LOAD = "load";

declare global {
  interface Window {
    ytInitialPlayerResponse?: PlayerResponse;
    ytInitialData?: {
      currentVideoEndpoint?: {
        watchEndpoint?: { videoId?: string };
      };
      contents?: {
        twoColumnWatchNextResults?: {
          results?: {
            results?: {
              contents?: Array<{
                videoPrimaryInfoRenderer?: {
                  title?: { runs?: Array<{ text?: string }> };
                };
              }>;
            };
          };
        };
      };
      header?: {
        playlistHeaderRenderer?: {
          title?: { simpleText?: string };
          playlistId?: string;
          ownerText?: { runs?: Array<{ text?: string }> };
        };
      };
      metadata?: {
        playlistMetadataRenderer?: { title?: string };
      };
    };
  }
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  world: "MAIN",
  allFrames: true,
  async main() {
    const isUnrelatedIframe = self !== top && !location.search.includes(YTDL_IFRAME_QUERY_PARAM);
    if (isUnrelatedIframe) {
      return;
    }

    if (self !== top) {
      setupIframeSilencer();
    }

    registerCrossWorldHandlers();
    registerGridDropdownHandlers();
    registerGridTagger();
    registerGridVideoDataHandler();

    document.addEventListener(EVENT_YT_NAVIGATE_FINISH, handleNavigateSuccess);
    document.addEventListener(EVENT_YT_NAVIGATE_FINISH, setupAudioTrackWatcher);
    document.addEventListener(EVENT_YT_NAVIGATE_FINISH, setupCaptionTrackWatcher);

    if (self === top) {
      function cancelAllAndNotify() {
        const videoIds = cancelAllActiveDownloads();
        const hasActiveDownloads = videoIds.length > 0;
        if (hasActiveDownloads) {
          crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds }).catch(() => {});
        }
      }

      document.addEventListener(EVENT_YT_NAVIGATE_START, cancelAllAndNotify);
      addEventListener(EVENT_PAGEHIDE, cancelAllAndNotify);
    }

    async function initializeOnLoad() {
      const options = await crossWorldMessenger.sendMessage(CrossWorldMessage.RequestOptions);
      initContentOptions(options);
      await extractAndDispatchVideoData();
      extractPlaylistMetadata();
      setupAudioTrackWatcher();
      setupCaptionTrackWatcher();
    }

    const isDocumentReady = document.readyState === "complete";
    if (isDocumentReady) {
      initializeOnLoad().catch(() => {});
    } else {
      addEventListener(EVENT_LOAD, () => {
        initializeOnLoad().catch(() => {});
      }, { once: true });
    }
  }
});
