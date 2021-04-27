import { getPageState } from "./yt-downloader-content-script-ui";
import { getElementByObserver, getVideoId } from "./yt-downloader-utils";
import { gObserverOptions } from "./yt-downloader-content-script-initialize";

const isDownloadable: {
  [id: string]: boolean;
} = {};

export function getIsVideoDownloadable(url: string): boolean {
  if (getPageState(url) === "regular-video") {
    const id = getVideoId(location.href);
    if (!isDownloadable[id]) {
      isDownloadable[id] = false;
    }

    const adaptiveFormats = JSON.parse(
      document.documentElement.dataset.adaptiveFormats
    );
    const { url: urlAdaptiveFormat, signatureCipher } = adaptiveFormats[0];

    // TODO: "signatureCipher" might not be decipherable to produce video URLs
    if (urlAdaptiveFormat || signatureCipher) {
      isDownloadable[id] = true;
      console.log(
        `Video ${id} is %cdownloadable`,
        "color: green; font-weight: bold;"
      );
      return true;
    }
    return false;
  }
}

getElementByObserver("title").then(elTitle => {
  let lastVideoId = getVideoId(location.href);
  new MutationObserver(() => {
    delete isDownloadable[lastVideoId];
    lastVideoId = getVideoId(location.href);
  }).observe(elTitle, gObserverOptions);
});
