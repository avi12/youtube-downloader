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
    if (self !== top && !location.search.includes(YTDL_IFRAME_QUERY_PARAM)) {
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
        if (videoIds.length > 0) {
          void crossWorldMessenger.sendMessage(CrossWorldMessage.CancelDownload, { videoIds });
        }
      }

      document.addEventListener(EVENT_YT_NAVIGATE_START, cancelAllAndNotify);
      addEventListener(EVENT_PAGEHIDE, cancelAllAndNotify);
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
      addEventListener(EVENT_LOAD, () => void initializeOnLoad(), { once: true });
    }
  }
});
