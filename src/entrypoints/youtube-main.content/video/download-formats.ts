import { resolveFormatUrl } from "./stream-fetch";
import { type AdaptiveFormatItem, DownloadType } from "@/types";

export { resolveCredentialsWithRetry } from "./download-credentials";

const MAX_ADDITIONAL_AUDIO_TRACKS = 16;

export function getExtraAudioFormats({ audioFormats, selectedTrackId, selectedFormat }: {
  audioFormats: AdaptiveFormatItem[];
  selectedTrackId: string | undefined;
  selectedFormat: AdaptiveFormatItem | null;
}) {
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

    if (seenTrackIds.has(trackId)) {
      continue;
    }

    seenTrackIds.add(trackId);
    result.push(format);
  }

  return result;
}

export function selectFormats({ videoData, type, videoItag, audioItag, audioTrackId }: {
  videoData: {
    videoFormats: AdaptiveFormatItem[];
    audioFormats: AdaptiveFormatItem[];
  };
  type: DownloadType;
  videoItag: number | undefined;
  audioItag: number | undefined;
  audioTrackId: string | undefined;
}) {
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

export async function preResolveCdnUrls({ type, videoFormat, audioFormat, extraAudioFormats }: {
  type: DownloadType;
  videoFormat: AdaptiveFormatItem | null;
  audioFormat: AdaptiveFormatItem | null;
  extraAudioFormats: AdaptiveFormatItem[];
}) {
  return Promise.all([
    type !== DownloadType.Audio ? resolveFormatUrl(videoFormat) : Promise.resolve(null),
    type !== DownloadType.Video ? resolveFormatUrl(audioFormat) : Promise.resolve(null),
    ...extraAudioFormats.map(format => resolveFormatUrl(format))
  ]);
}
