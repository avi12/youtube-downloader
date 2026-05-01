export const YouTubePath = {
  Watch: "/watch",
  Playlist: "/playlist"
} as const;

export type YouTubePath = (typeof YouTubePath)[keyof typeof YouTubePath];

export const ScrubUrlParam = {
  Ytdl: "ytdl",
  ScrubMode: "ytdlScrubMode",
  ScrubIndex: "ytdlScrubIndex",
  ScrubWindow: "ytdlScrubWindow",
  KeepPlaying: "ytdlKeepPlaying",
  TrustFactoryMode: "ytdlTrustFactoryMode",
  FactoryId: "ytdlFactoryId"
} as const;

export type ScrubUrlParam = (typeof ScrubUrlParam)[keyof typeof ScrubUrlParam];

export function getVideoIdFromUrl(url: string) {
  try {
    return new URLSearchParams(new URL(url).search).get("v");
  } catch {
    return null;
  }
}
