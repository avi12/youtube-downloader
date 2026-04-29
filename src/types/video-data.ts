import type { SabrConfig } from "./download";
import type { AdaptiveFormatItem, CaptionTrack, PlayerResponse } from "./youtube";

export type VideoData = {
  playerResponse: PlayerResponse;
  videoId: string;
  title: string;
  isMusic: boolean;
  isDownloadable: boolean;
  isLive: boolean;
  videoFormats: AdaptiveFormatItem[];
  audioFormats: AdaptiveFormatItem[];
  sabrConfig: SabrConfig | null;
  captionTracks: CaptionTrack[];
};
