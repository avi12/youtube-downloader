import { getVideoData } from "./yt-downloader-functions";
import { gCancelControllers } from "./yt-downloader-content-script-initialize";
import type { PlayerResponse } from "./types";

export async function handlePlaylist(): Promise<void> {
  const urlVideos = [...document.querySelectorAll("#video-title")].reduce(
    (urls, elTitle: HTMLAnchorElement) => {
      if (elTitle.offsetWidth > 0 && elTitle.offsetHeight > 0) {
        urls.push(elTitle.href);
      }
      return urls;
    },
    []
  );

  const promiseHtmls = urlVideos.map(async url => {
    const abortController = new AbortController();
    gCancelControllers.push(abortController);
    const response = await fetch(url, { signal: abortController.signal });
    return response.text();
  });

  for await (const htmlVideo of promiseHtmls) {
    const videoData: PlayerResponse = await getVideoData(htmlVideo);
  }
}
