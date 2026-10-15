const WATCH_PAGE_HOSTNAME = "www.youtube.com";
const MOBILE_WATCH_PAGE_HOSTNAME = "m.youtube.com";
export const YOUTUBE_ORIGIN = `https://${WATCH_PAGE_HOSTNAME}`;
export const WATCH_PAGE_PATHNAME = "/watch";
const PLAYLIST_PAGE_PATHNAME = "/playlist";
export const WATCH_PAGE_URL = `${YOUTUBE_ORIGIN}${WATCH_PAGE_PATHNAME}`;

export function buildWatchUrl(videoId: string) {
  return `${WATCH_PAGE_URL}?v=${videoId}`;
}

export function buildPlaylistUrl(playlistId: string) {
  return `${YOUTUBE_ORIGIN}${PLAYLIST_PAGE_PATHNAME}?list=${playlistId}`;
}

export function getVideoIdFromUrl(url: string) {
  try {
    return new URLSearchParams(new URL(url).search).get("v");
  } catch {
    return null;
  }
}

function isWatchPageOnHost(url: string, expectedHostname: string) {
  const parsed = URL.parse(url);
  return parsed?.hostname === expectedHostname && parsed.pathname === WATCH_PAGE_PATHNAME;
}

export function isWatchPageUrl(url: string) {
  return isWatchPageOnHost(url, WATCH_PAGE_HOSTNAME);
}

// The mobile site gets no injected UI - the popup downloads its video through the hidden watch-page iframe
export function isMobileWatchPageUrl(url: string) {
  return isWatchPageOnHost(url, MOBILE_WATCH_PAGE_HOSTNAME);
}
