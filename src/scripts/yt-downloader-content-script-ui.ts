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
<svg width="14" height="18" viewBox="0 0 14 18" xmlns="http://www.w3.org/2000/svg">
<path d="M14 6.04166H10V0.0416641H4V6.04166H0L7 13.0417L14 6.04166ZM0 15.0417V17.0417H14V15.0417H0Z" />
</svg>
`;

const gHtmlButtonContent = `
  <a class="yt-simple-endpoint ytd-button-renderer" tabindex="-1">
      <button id="button" class="style-scope yt-icon-button yt-downloader-icon">
        ${gIconSvgDownload}
      </button>
    <div class="yt-downloader-color yt-downloader-text">Download</div>
  </a>
  <progress value="0" max="100" class="yt-downloader-progress" data-yt-downloader-tooltip="{data-value}"></progress>
`;

function getButtonDownload(reasonUndownloadable?: string): HTMLElement {
  const elButton = document.createElement("div");
  elButton.setAttribute(gSelButtonDownload, "download-video-simple");
  elButton.dataset.ytDownloaderTooltip = "true";
  elButton.innerHTML = gHtmlButtonContent;
  if (reasonUndownloadable) {
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

    if (!elButtonBeforeRating || document.querySelector(`[${gSelButtonDownload}]`)) {
      return;
    }

    elButtonBeforeRating.parentElement.insertBefore(
      elButtonDownload,
      elButtonBeforeRating
    );

    const elVideo = await getElementEventually("video") as HTMLVideoElement;
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
