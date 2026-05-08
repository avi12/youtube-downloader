export const YouTubePath = {
  Watch: "/watch",
  Playlist: "/playlist",
  Subscriptions: "/feed/subscriptions",
  SearchResults: "/results"
} as const;

export type YouTubePath = (typeof YouTubePath)[keyof typeof YouTubePath];

export function getVideoIdFromUrl(url: string) {
  try {
    return new URLSearchParams(new URL(url).search).get("v");
  } catch {
    return null;
  }
}
