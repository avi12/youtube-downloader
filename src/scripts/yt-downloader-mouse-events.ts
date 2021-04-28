import { getVideoId } from "./yt-downloader-utils";
import { gSelButtonDownload } from "./yt-downloader-content-script-ui";
import type { VideoData } from "./types";

const isEventRegistered: { [event: string]: boolean } = {};

export function registerMouseEventListeners() {
  if (!isEventRegistered.click) {
    isEventRegistered.click = true;
    document.addEventListener("click", async ({ target }) => {
      const elButtonDownload = (target as HTMLElement).closest(
        `[${gSelButtonDownload}]`
      );
      if (!elButtonDownload) {
        return;
      }

      switch (elButtonDownload.getAttribute(gSelButtonDownload)) {
        case "download-video-simple":
          downloadSendToBackground({
            id: getVideoId(location.href),
            qualityChosen: Number(
              elButtonDownload.getAttribute(
                "data-yt-downloader-current-quality"
              )
            ),
            videoDataRaw: window.videoDataRaw as VideoData
          });
          break;
      }
    });
  }
}

function downloadSendToBackground(params: {
  id: string;
  qualityChosen: number;
  videoDataRaw: VideoData;
}) {
  const portDownload = chrome.runtime.connect({
    name: "download-video-simple"
  });
  portDownload.postMessage(params);
}
