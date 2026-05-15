import type { AdaptiveFormatItem } from "@/types";

export function normalizeLanguageCode(lang: string) {
  return lang.split("-")[0].split(".")[0].toLowerCase();
}

export function getCurrentVideoAudioLanguage(): string | null {
  const elVideo = document.querySelector<HTMLVideoElement>("video.html5-main-video");
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

  return audioFormats.find(format => format.audioTrack?.id.endsWith(".4"))
    ?? audioFormats.find(format => format.audioTrack?.displayName.includes("(original)"))
    ?? audioFormats.find(format => format.audioTrack?.audioIsDefault)
    ?? null;
}

export function sortAudioFormatsByDisplayName(audioFormats: AdaptiveFormatItem[]) {
  return audioFormats
    .filter(format => format.audioTrack)
    .toSorted((formatA, formatB) =>
      formatA.audioTrack!.displayName.localeCompare(formatB.audioTrack!.displayName));
}
