import { getVideoId } from "./yt-downloader-utils";
import { gSelButtonDownload } from "./yt-downloader-content-script-ui";
import type { AdaptiveFormatItem } from "./types";

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
            quality: Number(elButtonDownload.getAttribute(
              "data-yt-downloader-current-quality"
            )),
            titleCurrent: document.documentElement.dataset.videoTitle,
            adaptiveFormats: JSON.parse(
              document.documentElement.dataset.adaptiveFormats
            ),
            ytcfg: JSON.parse(document.documentElement.dataset.ytcfg)
          });
          break;
      }
    });
  }
}

function downloadSendToBackground(params: {
  id: string;
  quality: number;
  adaptiveFormats?: AdaptiveFormatItem[];
  titleCurrent?: string;
  ytcfg?: { STS: number; PLAYER_JS_URL: string };
}) {
  const portDownload = chrome.runtime.connect({
    name: "download-video-simple"
  });
  portDownload.postMessage(params);
}
