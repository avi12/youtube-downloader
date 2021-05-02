import { getElementEventually, getVideoId } from "./yt-downloader-utils";
import {
  gSelButtonDownload
} from "./yt-downloader-content-script-ui";
import type { VideoData } from "./types";

const isEventRegistered: { [event: string]: boolean } = {};
let isClicked;

let elProgress: HTMLProgressElement;
async function getProgressElement() {
  if (elProgress?.offsetWidth > 0) {
    return elProgress;
  }
  elProgress = (await getElementEventually(
    ".yt-downloader-progress"
  )) as HTMLProgressElement;
  return elProgress;
}

async function handleClick({ target }: { target: EventTarget }) {
  const elButtonDownload = (target as HTMLElement).closest(
    `[${gSelButtonDownload}]`
  ) as HTMLElement;
  if (
    !elButtonDownload ||
    elButtonDownload.dataset.ytDownloaderUndownloadable
  ) {
    return;
  }

  switch (elButtonDownload.getAttribute(gSelButtonDownload)) {
    case "download-video-simple":
      if (isClicked) {
        gPortDownload.disconnect();
        gPortDownload = getPort("download-video-simple");
        isClicked = false;
        return;
      }
      isClicked = true;

      downloadSendToBackground({
        id: getVideoId(location.href),
        qualityChosen: Number(
          elButtonDownload.getAttribute("data-yt-downloader-current-quality")
        ),
        videoDataRaw: window.videoDataRaw as VideoData
      });
      gPortDownload.onMessage.addListener(async (progress: number) => {
        const elProgress = await getProgressElement();
        elProgress.value = progress;
      });
      break;
  }
}

export function registerMouseEventListeners() {
  if (!isEventRegistered.click) {
    isEventRegistered.click = true;
    document.addEventListener("click", handleClick);
  }
}

function getPort(name: string): chrome.runtime.Port {
  return chrome.runtime.connect({ name });
}
let gPortDownload = getPort("download-video-simple");
function downloadSendToBackground(params: {
  id: string;
  qualityChosen: number;
  videoDataRaw: VideoData;
}) {
  gPortDownload.postMessage(params);
}
