import { getPageState } from "./yt-downloader-content-script-ui";
import {
  getElementByObserver,
  getVideoInfo,
  getVideoId
} from "./yt-downloader-utils";
import { gObserverOptions } from "./yt-downloader-content-script-initialize";
import type { VideoData } from "./types";

const isDownloadable: {
  [id: string]: boolean;
} = {};

export async function getIsVideoDownloadable(
  url: string
): Promise<VideoData | boolean> {
  if (getPageState(url) === "regular-video") {
    const id = getVideoId(location.href);
    if (!isDownloadable[id]) {
      isDownloadable[id] = false;
    }

    const videoDataRaw = await getVideoInfo(id);
    // const {
    //   url: urlAdaptiveFormat,
    //   signatureCipher
    // } = videoDataRaw.player_response.streamingData?.adaptiveFormats?.[0];
    //
    // TODO: "signatureCipher" might not be decipherable to produce video URLs
    // TODO: Handle videos that are only downloadable after deciphering
    isDownloadable[id] = true;
    console.log(
      `Video ${id} is %cdownloadable`,
      "color: green; font-weight: bold;"
    );
    return videoDataRaw;
  }
}

getElementByObserver("title").then(elTitle => {
  let lastVideoId = getVideoId(location.href);
  new MutationObserver(() => {
    delete isDownloadable[lastVideoId];
    lastVideoId = getVideoId(location.href);
  }).observe(elTitle, gObserverOptions);
});
