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
  const isSelectedAutoDub = !includeAutoDubbing && selectedTrackId?.endsWith(AUTO_DUB_TRACK_SUFFIX);
  if (isSelectedAutoDub) {
    return [];
  }

  const seenTrackIds = new Set(selectedTrackId ? [selectedTrackId] : []);
  let isUntaggedExtraPresent = !selectedTrackId;
  const result: AdaptiveFormatItem[] = [];
  for (const format of audioFormats) {
    const isAtTrackLimit = result.length >= MAX_ADDITIONAL_AUDIO_TRACKS;
    if (isAtTrackLimit) {
      break;
    }

    const isSelectedFormat = format === selectedFormat;
    if (isSelectedFormat) {
      continue;
    }

    const trackId = format.audioTrack?.id;
    if (!trackId) {
      if (isUntaggedExtraPresent) {
        continue;
      }

      isUntaggedExtraPresent = true;
      result.push(format);
      continue;
    }

    const isAutoDubTrack = !includeAutoDubbing && trackId.endsWith(AUTO_DUB_TRACK_SUFFIX);
    if (isAutoDubTrack) {
      continue;
    }

    const isTrackAlreadySeen = seenTrackIds.has(trackId);
    if (isTrackAlreadySeen) {
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
  const isVideoRequested = type !== DownloadType.Audio;
  const videoFormat = isVideoRequested
    ? (videoData.videoFormats.find(format => format.itag === videoItag) ?? videoData.videoFormats[0])
    : null;

  let audioFormat: AdaptiveFormatItem | null = null;
  const isAudioRequested = type !== DownloadType.Video;
  if (isAudioRequested) {
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
  const videoUrlPromise = type !== DownloadType.Audio ? resolveFormatUrl(videoFormat) : Promise.resolve(null);
  const audioUrlPromise = type !== DownloadType.Video ? resolveFormatUrl(audioFormat) : Promise.resolve(null);
  return Promise.all([
    videoUrlPromise,
    audioUrlPromise,
    ...extraAudioFormats.map(format => resolveFormatUrl(format))
  ]);
}
