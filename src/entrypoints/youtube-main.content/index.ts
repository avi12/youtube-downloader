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
    if (self !== top && !/ytdl=1/.test(location.search)) {
      return;
    }

    if (self !== top) {
      setupIframeSilencer();
    }

    registerCrossWorldHandlers();
    registerGridDropdownHandlers();
    registerGridTagger();
    registerGridVideoDataHandler();

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
