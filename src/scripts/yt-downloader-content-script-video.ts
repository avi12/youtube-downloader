import { getVideoData } from "./yt-downloader-functions";
import { gCancelControllers } from "./yt-downloader-content-script-initialize";
import type { PlayerResponse } from "./types";

export async function handleVideo(): Promise<void> {
  const getHtml = async () => {
    const abortController = new AbortController();
    gCancelControllers.push(abortController);
    const response = await fetch(location.href, {
      signal: abortController.signal
    });
    return response.text();
  };

  window.videoDataRaw = await getVideoData(await getHtml());

  document.querySelector("video").dataset.ytDownloaderVideoData =
    JSON.stringify(window.videoDataRaw);

  const getIsLive = (videoDataRaw: PlayerResponse) =>
    videoDataRaw.microformat?.playerMicroformatRenderer.liveBroadcastDetails
      ?.isLiveNow;

  if (getIsLive(window.videoDataRaw)) {
    // TODO: Add "Undownloadable"
    return;
  }
}
