import { resolveFormatUrl } from "./stream-fetch";
import { type AdaptiveFormatItem, DownloadType } from "@/types";

export { resolveCredentialsWithRetry } from "./download-credentials";

const MAX_ADDITIONAL_AUDIO_TRACKS = 16;
const AUTO_DUB_TRACK_SUFFIX = ".10";

type GetExtraAudioFormatsParams = {
  audioFormats: AdaptiveFormatItem[];
  selectedTrackId: string | undefined;
  selectedFormat: AdaptiveFormatItem | null;
  includeAutoDubbing: boolean;
};
export function getExtraAudioFormats({
  audioFormats, selectedTrackId, selectedFormat, includeAutoDubbing
}: GetExtraAudioFormatsParams) {
  if (!includeAutoDubbing && selectedTrackId?.endsWith(AUTO_DUB_TRACK_SUFFIX)) {
    return [];
  }

  const seenTrackIds = new Set(selectedTrackId ? [selectedTrackId] : []);
  let hasUntaggedExtra = !selectedTrackId;
  const result: AdaptiveFormatItem[] = [];
  for (const format of audioFormats) {
    if (result.length >= MAX_ADDITIONAL_AUDIO_TRACKS) {
      break;
    }

    if (format === selectedFormat) {
      continue;
    }

    const trackId = format.audioTrack?.id;
    if (!trackId) {
      if (hasUntaggedExtra) {
        continue;
      }

      hasUntaggedExtra = true;
      result.push(format);
      continue;
    }

    if (!includeAutoDubbing && trackId.endsWith(AUTO_DUB_TRACK_SUFFIX)) {
      continue;
    }

    if (seenTrackIds.has(trackId)) {
      continue;
    }

    seenTrackIds.add(trackId);
    result.push(format);
  }

  return result;
}

type SelectFormatsParams = {
  videoData: {
    videoFormats: AdaptiveFormatItem[];
    audioFormats: AdaptiveFormatItem[];
  };
  type: DownloadType;
  videoItag: number | undefined;
  audioItag: number | undefined;
  audioTrackId: string | undefined;
};
export function selectFormats({
  videoData, type, videoItag, audioItag, audioTrackId
}: SelectFormatsParams) {
  const videoFormat = type !== DownloadType.Audio
    ? (videoData.videoFormats.find(format => format.itag === videoItag) ?? videoData.videoFormats[0])
    : null;

  let audioFormat: AdaptiveFormatItem | null = null;
  if (type !== DownloadType.Video) {
    const byItag = videoData.audioFormats.filter(format => format.itag === audioItag);
    audioFormat = (audioTrackId
      ? byItag.find(format => format.audioTrack?.id === audioTrackId)
      : null)
      ?? byItag[0]
      ?? videoData.audioFormats[0];
  }

  return {
    videoFormat,
    audioFormat
  };
}

type PreResolveCdnUrlsParams = {
  type: DownloadType;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem | null;
  extraAudioFormats: AdaptiveFormatItem[];
};
export async function preResolveCdnUrls({
  type, videoFormat, audioFormat, extraAudioFormats
}: PreResolveCdnUrlsParams) {
  return Promise.all([
    type !== DownloadType.Audio ? resolveFormatUrl(videoFormat) : Promise.resolve(null),
    type !== DownloadType.Video ? resolveFormatUrl(audioFormat) : Promise.resolve(null),
    ...extraAudioFormats.map(format => resolveFormatUrl(format))
  ]);
}
