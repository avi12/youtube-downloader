export const YouTubePath = {
  Watch: "/watch",
  Playlist: "/playlist"
} as const;

export type YouTubePath = (typeof YouTubePath)[keyof typeof YouTubePath];

export const FactoryUrlParam = {
  TrustFactoryMode: "ytdlTrustFactoryMode",
  FactoryId: "ytdlFactoryId"
} as const;

export function getVideoIdFromUrl(url: string) {
  try {
    return new URLSearchParams(new URL(url).search).get("v");
  } catch {
    return null;
  }
}
