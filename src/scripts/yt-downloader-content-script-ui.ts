import { registerMouseEventListeners } from "./yt-downloader-mouse-events";
import { getElementEventually } from "./yt-downloader-utils";
import { storeCurrentQuality } from "./yt-downloader-content-script-initialize";

export const gSelButtonDownload = "data-yt-downloader-action";

export function getPageState(
  url = location.href
): "video-in-playlist" | "regular-video" | "playlist-page" | "playlists-page" {
  const searchParams = new URLSearchParams(new URL(url).search);
  const isVideoPage = location.pathname === "/watch";
  if (isVideoPage) {
    if (searchParams.get("list")) {
      return "video-in-playlist";
    }
    return "regular-video";
  }

  if (searchParams.get("list")) {
    return "playlist-page";
  }

  if (location.pathname.endsWith("/playlists")) {
    return "playlists-page";
  }
}

const gIconSvgDownload = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/>
</svg>
`;
const gIconSvgNoDownload = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path d="M9 6.17V3h6v6h4l-3.59 3.59L9 6.17zm12.19 15.02L2.81 2.81 1.39 4.22 6.17 9H5l7 7 .59-.59L15.17 18H5v2h12.17l2.61 2.61 1.41-1.42z"/>
</svg>
`;

const gHtmlButtonContent = isDownloadable => `
  <a class="yt-simple-endpoint ytd-button-renderer" tabindex="-1" data-yt-downloader-tooltip="true">
      <button id="button" class="style-scope yt-icon-button yt-downloader-icon">
        ${isDownloadable ? gIconSvgDownload : gIconSvgNoDownload}
      </button>
    <div class="yt-downloader-color yt-downloader-text">Download</div>
  </a>
  <progress max="100" class="yt-downloader-progress" data-yt-downloader-tooltip="{data-value}"></progress>
`;

function getButtonDownload(reasonUndownloadable?: string): HTMLElement {
  const elButton = document.createElement("button");
  elButton.setAttribute(gSelButtonDownload, "download-video-simple");
  elButton.innerHTML = gHtmlButtonContent(!reasonUndownloadable);
  if (reasonUndownloadable) {
    elButton.style.transform = "translateY(2px)";
    elButton.dataset.ytDownloaderTooltip = reasonUndownloadable;
    elButton.dataset.ytDownloaderUndownloadable = "true";
  }
  return elButton;
}

export async function makeUI(reasonUndownloadable?: string) {
  registerMouseEventListeners();
  if (getPageState() === "regular-video") {
    const elButtonDownload = getButtonDownload(reasonUndownloadable);
    const elButtonBeforeRating = await getElementEventually(
      "#top-level-buttons > ytd-button-renderer"
    );

    if (
      !elButtonBeforeRating ||
      document.querySelector(`[${gSelButtonDownload}]`)
    ) {
      return;
    }

    elButtonBeforeRating.parentElement.insertBefore(
      elButtonDownload,
      elButtonBeforeRating
    );

    const elVideo = (await getElementEventually("video")) as HTMLVideoElement;
    elVideo.addEventListener("canplay", storeCurrentQuality);
    return;
  }
  if (getPageState() === "video-in-playlist") {
    return;
  }
  if (getPageState() === "playlist-page") {
    return;
  }
  if (getPageState() === "playlists-page") {
    return;
  }

  // Scenarios:
  // Video page with no playlist
  // Video page as a part of a playlist
  // Playlist page
  // Append to videos' context menus

  // YouTube Originals

  // Features:
  // Video cut slider
  // Quality picker on right-click
  // Customizable title & format

  // Options:
  // Default format - custom or MKV
  // Quality - current or highest
}
