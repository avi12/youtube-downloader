import { getElementByObserver } from "./yt-downloader-utils";
import { getQuality } from "./yt-downloader-retrieve-player-metadata";
import { getIsVideoDownloadable } from "./yt-downloader-verify-downloadablility";
import { gSelButtonDownload, makeUI } from "./yt-downloader-content-script-ui";
import type { PlayerResponse, VideoData } from "./types";

export const gObserverOptions = { childList: true, subtree: true };
const gIdScript = "yt-downloader-script-to-inject";

function storeCurrentQuality() {
  const elDownloader = document.querySelector(`[${gSelButtonDownload}]`);
  elDownloader.setAttribute(
    "data-yt-downloader-current-qualityChosen",
    getQuality()
  );
}

getElementByObserver("title").then(elTitle => {
  new MutationObserver(() => {
    const elVideo = document.querySelector("video");
    elVideo.removeEventListener("canplay", storeCurrentQuality);
    elVideo.addEventListener("canplay", storeCurrentQuality);
    window.videoDataRaw = null;
  }).observe(elTitle, gObserverOptions);
});

declare global {
  interface Window {
    videoDataRaw: VideoData | boolean | null;
  }
}

window.videoDataRaw = null;
new MutationObserver(async (_, observer) => {
  if (window.videoDataRaw === null) {
    window.videoDataRaw = await getIsVideoDownloadable(location.href);
  }
  if (!window.videoDataRaw) {
    return;
  }

  const elButtonBeforeRating = document.querySelector(
    "#top-level-buttons > ytd-button-renderer"
  );

  if (!elButtonBeforeRating) {
    return;
  }

  makeUI();
  storeCurrentQuality();
  observer.disconnect();
}).observe(document.body, gObserverOptions);
