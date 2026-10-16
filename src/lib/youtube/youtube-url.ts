const WATCH_PAGE_HOSTNAME = "www.youtube.com";
const MOBILE_WATCH_PAGE_HOSTNAME = "m.youtube.com";
const MUSIC_WATCH_PAGE_HOSTNAME = "music.youtube.com";
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

export function isMobileWatchPageUrl(url: string) {
  return isWatchPageOnHost(url, MOBILE_WATCH_PAGE_HOSTNAME);
}

export function isMusicWatchPageUrl(url: string) {
  return isWatchPageOnHost(url, MUSIC_WATCH_PAGE_HOSTNAME);
}

// These sites get no injected UI - the popup downloads their videos through the hidden watch-page iframe
export function isPopupOnlyWatchPageUrl(url: string) {
  return isMobileWatchPageUrl(url) || isMusicWatchPageUrl(url);
}
