export type SubtitleStream = {
  srtContent: string;
  languageCode: string;
  label: string;
};

export type ScrubSegment = {
  video: Uint8Array;
  audio: Uint8Array;
  videoBufferStartSec?: number;
};

export type VideoMetadata = {
  title: string;
  artist: string;
  albumArtist?: string;
  album?: string;
  genres?: string[];
  date?: string;
  thumbnailUrl?: string;
  isMusic: boolean;
};
