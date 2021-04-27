import { registerMouseEventListeners } from "./yt-downloader-mouse-events";

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
<svg xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" focusable="false" style="pointer-events: none; display: block; width: 24px; height: 24px;" class="style-scope yt-icon">
  <!--suppress HtmlUnknownAttribute -->
  <g class="style-scope yt-icon" mirror-in-rtl="">
    <path d="M0 0h24v24H0z" fill="none" />
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
  </g>
</svg>
`;

const gHtmlButton = `
  <ytd-button-renderer ${gSelButtonDownload}="download-video-simple" class="yt-downloader style-scope ytd-menu-renderer force-icon-button style-default size-default" use-keyboard-focused="" button-renderer="true" style-action-button="" is-icon-button="">
    <a class="yt-simple-endpoint ytd-button-renderer" tabindex="-1">
      <yt-icon id="button" class="style-scope ytd-button-renderer">
        <button id="button" class="style-scope yt-icon-button">
          ${gIconSvgDownload}
        </button>
      </yt-icon>
      <yt-formatted-string id="text" class="style-scope ytd-button-renderer style-default size-default">Download</yt-formatted-string>
    </a>
  </ytd-button-renderer>
`;

function getButtonDownload(): HTMLElement {
  return new DOMParser().parseFromString(gHtmlButton, "text/xml")
    .documentElement;
}

export function makeUI() {
  registerMouseEventListeners();
  if (getPageState() === "regular-video") {
    const elButtonDownload = getButtonDownload();
    const elButtonBeforeRating = document.querySelector(
      "#top-level-buttons > ytd-button-renderer"
    );

    if (document.querySelector(`[${gSelButtonDownload}]`)) {
      return;
    }

    elButtonBeforeRating.parentElement.insertBefore(
      elButtonDownload,
      elButtonBeforeRating
    );
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
