import { registerGridDropdownHandlers } from "./grid/grid-dropdown";
import { registerGridTagger } from "./grid/grid-tagger";
import { registerGridVideoDataHandler } from "./grid/grid-video-data";
import { setupIframeVideoSilencing } from "./iframe-setup";
import { registerMainWorldHandlers } from "./main-world-handlers";
import { runScrubSelfDrive, runTrustFactoryDrive } from "./scrub/self-drive";
import { cancelActiveDownload } from "./video/download";
import { extractPlaylistMetadata, handleNavigateSuccess } from "./video/playlist-metadata";
import { extractAndDispatchVideoData } from "./video/video-data";
import type { PlayerResponse } from "@/types";

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
  world: browser.scripting.ExecutionWorld.MAIN,
  allFrames: true,
  async main() {
    if (location.search.includes("ytdlScrubMode=1")) {
      try {
        if (parent !== self) {
          parent.postMessage({
            type: "ytdl:scrub-debug",
            msg: `[ytdl:scrub-tab] MAIN booted url=${location.search.slice(0, 120)}`
          }, "*");
        }
      } catch {
        // best-effort debug log
      }

      await runScrubSelfDrive();
      return;
    }

    if (location.search.includes("ytdlTrustFactoryMode=1")) {
      await runTrustFactoryDrive();
      return;
    }

    if (self !== top && !location.search.includes("ytdl=1")) {
      return;
    }

    if (self !== top) {
      setupIframeVideoSilencing();
    }

    registerMainWorldHandlers();
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
