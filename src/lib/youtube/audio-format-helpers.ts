import type { AdaptiveFormatItem } from "@/types";

const AUDIO_TRACK_ORIGINAL_SUFFIX = ".4";
const AUDIO_TRACK_ORIGINAL_LABEL = "(original)";
const VIDEO_SELECTOR = "video.html5-main-video";

export function normalizeLanguageCode(lang: string) {
  return lang.split("-")[0].split(".")[0].toLowerCase();
}

export function getCurrentVideoAudioLanguage() {
  const elVideo = document.querySelector<HTMLVideoElement>(VIDEO_SELECTOR);
  const tracks = elVideo?.audioTracks;
  const hasNoTracks = !tracks?.length;
  if (hasNoTracks) {
    return null;
  }

  for (const track of tracks) {
    if (track.enabled) {
      return normalizeLanguageCode(track.language);
    }
  }

  return null;
}

export function findOriginalAudioFormat(audioFormats: AdaptiveFormatItem[]) {
  const noTrack = audioFormats.find(format => !format.audioTrack);
  if (noTrack) {
    return noTrack;
  }

  return audioFormats.find(format => format.audioTrack?.id.endsWith(AUDIO_TRACK_ORIGINAL_SUFFIX))
    ?? audioFormats.find(format => format.audioTrack?.displayName.includes(AUDIO_TRACK_ORIGINAL_LABEL))
    ?? audioFormats.find(format => format.audioTrack?.audioIsDefault)
    ?? null;
}

export function sortAudioFormatsByDisplayName(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats
    .filter(format => format.audioTrack)
    .toSorted((formatA, formatB) =>
      formatA.audioTrack!.displayName.localeCompare(formatB.audioTrack!.displayName));
}
