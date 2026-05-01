import { StreamType } from "@/types";
import type { AdaptiveFormatItem, PlayerResponse } from "@/types";

export function getUniqueVideoFormats(formats: AdaptiveFormatItem[]) {
  const videoFormats = formats.filter(format => format.mimeType.startsWith(StreamType.Video));
  const seen = new Set<string>();

  return videoFormats.filter(format => {
    if (!format.height) {
      return false;
    }

    const isPremium = (format.qualityLabel ?? "").includes("Premium");
    const key = `${format.height}-${isPremium}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function getAudioFormats(formats: AdaptiveFormatItem[], preferredLanguage: string) {
  const audioFormats = formats.filter(format => format.mimeType.startsWith(StreamType.Audio));
  const seenKeys = new Set<string>();
  const deduped = audioFormats.filter(format => {
    const key = `${format.itag}:${format.audioTrack?.id ?? ""}`;
    if (seenKeys.has(key)) {
      return false;
    }

    seenKeys.add(key);
    return true;
  });
  if (!preferredLanguage || deduped.every(format => !format.audioTrack)) {
    return deduped;
  }

  const langCode = preferredLanguage.toLowerCase().split("-")[0];

  function isPreferredTrack(format: AdaptiveFormatItem) {
    const trackId = format.audioTrack?.id?.toLowerCase() ?? "";
    return trackId === langCode || trackId.split(":").includes(langCode);
  }

  return [...deduped.filter(isPreferredTrack), ...deduped.filter(format => !isPreferredTrack(format))];
}

export function getCaptionTracks(playerResponse: PlayerResponse, preferredLanguage: string) {
  const allTracks = playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const manualTracks = allTracks.filter(track => track.kind !== "asr");
  const tracks = manualTracks.length > 0 ? manualTracks : allTracks;
  if (!preferredLanguage || tracks.length === 0) {
    return tracks;
  }

  const langCode = preferredLanguage.toLowerCase().split("-")[0];
  const preferred = tracks.filter(track => track.languageCode.toLowerCase().split("-")[0] === langCode);
  const rest = tracks.filter(track => track.languageCode.toLowerCase().split("-")[0] !== langCode);
  return [...preferred, ...rest];
}

export function byBitrateDesc(formatA: AdaptiveFormatItem, formatB: AdaptiveFormatItem) {
  return formatB.bitrate - formatA.bitrate;
}
