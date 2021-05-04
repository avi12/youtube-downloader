import {
  getElementByObserver,
  getStorage,
  getVideoId,
  getVideoInfo
} from "./yt-downloader-utils";
import { getQuality } from "./yt-downloader-retrieve-player-metadata";
import {
  getPageState,
  gSelButtonDownload,
  makeUI
} from "./yt-downloader-content-script-ui";
import type { VideoData } from "./types";

export const gObserverOptions = { childList: true, subtree: true };

export async function storeCurrentQuality() {
  const elDownloader = document.querySelector(
    `[${gSelButtonDownload}]`
  ) as HTMLElement;
  elDownloader.dataset.ytDownloaderCurrentQuality = getQuality();

  if (!window.videoDataRaw) {
    window.videoDataRaw = await getVideoMetadata(location.href);
  }

  const { microformat, streamingData } = window.videoDataRaw.player_response;

  elDownloader.dataset.ytDownloaderProjectionMode = streamingData.adaptiveFormats[0].qualityLabel.match(
    /\D/
  )[0];
  elDownloader.dataset.ytDownloaderCategory =
    microformat.playerMicroformatRenderer.category;

  const elTooltip = elDownloader.querySelector(
    "[data-yt-downloader-tooltip]"
  ) as HTMLElement;
  elTooltip.dataset.ytDownloaderTooltip =
    elTooltip.dataset.ytDownloaderTooltip || "true";

  const extMusic = "mp3";
  elTooltip.dataset.ytDownloaderMusicExt = extMusic.toUpperCase() || "MP3";

  elTooltip.dataset.ytDownloaderCurrentQuality =
    elDownloader.dataset.ytDownloaderCurrentQuality;

  elTooltip.dataset.ytDownloaderProjectionMode =
    elDownloader.dataset.ytDownloaderProjectionMode;
}

async function getVideoMetadata(url: string): Promise<VideoData> {
  if (getPageState(url) === "regular-video") {
    const id = getVideoId(location.href);
    return getVideoInfo(id);
  }
  // @ts-ignore
  return { status: "fail" };
}

getElementByObserver("title").then(elTitle => {
  new MutationObserver(() => {
    window.videoDataRaw = null;
    init();
  }).observe(elTitle, gObserverOptions);
});

declare global {
  interface Window {
    videoDataRaw: VideoData;
  }
}

window.videoDataRaw = null;

async function init() {
  if (!window.videoDataRaw) {
    window.videoDataRaw = await getVideoMetadata(location.href);
  }

  if (window.videoDataRaw.status === "fail") {
    await makeUI("Cannot download video");
    return;
  }

  const { isLive } = window.videoDataRaw.player_response.videoDetails;
  if (isLive) {
    await makeUI("Cannot download a live stream");
    return;
  }

  const isFFmpegReady = await getStorage("local", "isFFmpegReady");
  if (!isFFmpegReady) {
    chrome.storage.onChanged.addListener(changes => {
      if (changes?.isFFmpegReady.newValue) {
        init();
      }
    });
    return;
  }

  await makeUI();
  await storeCurrentQuality();
}
init();
