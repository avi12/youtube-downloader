const WATCH_PAGE_HOSTNAME = "www.youtube.com";
export const WATCH_PAGE_PATHNAME = "/watch";

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
