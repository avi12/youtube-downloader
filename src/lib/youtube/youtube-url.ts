export function getVideoIdFromUrl(url: string) {
  try {
    return new URLSearchParams(new URL(url).search).get("v");
  } catch {
    return null;
  }
}

export function getPlaylistIdFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const isPlaylistPage = parsed.pathname === "/playlist";
    if (!isPlaylistPage) {
      return null;
    }

    return new URLSearchParams(parsed.search).get("list");
  } catch {
    return null;
  }
}
