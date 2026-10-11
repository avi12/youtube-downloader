const WATCH_PAGE_HOSTNAME = "www.youtube.com";
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

export function isWatchPageUrl(url: string) {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname === WATCH_PAGE_HOSTNAME && pathname === WATCH_PAGE_PATHNAME;
  } catch {
    return false;
  }
}
