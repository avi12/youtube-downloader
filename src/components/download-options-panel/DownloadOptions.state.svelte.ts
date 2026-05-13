import { byLabel } from "./download-options-helpers";
import {
  findOriginalAudioFormat,
  formatAudioCodecLabel,
  formatVideoQualityLabel,
  normalizeLanguageCode
} from "@/lib/youtube/video-helpers";
import { DownloadType } from "@/types";
import type { AdaptiveFormatItem, CaptionTrack } from "@/types";
import { SvelteSet } from "svelte/reactivity";

export interface DownloadOptionsProps {
  downloadType: DownloadType;
  videoFormats: AdaptiveFormatItem[];
  audioFormats: AdaptiveFormatItem[];
  captionTracks: CaptionTrack[];
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  selectedCaptionTrack: CaptionTrack | null;
}

export function createDownloadOptionsState(props: () => DownloadOptionsProps) {
  const isAudio = $derived(props().downloadType === DownloadType.Audio);

  const uniqueAudioLanguages = $derived.by(() => {
    const seen = new SvelteSet<string>();
    const result: {
      value: string;
      label: string;
    }[] = [];
    for (const format of props().audioFormats) {
      if (!format.audioTrack) {
        continue;
      }

      const langCode = normalizeLanguageCode(format.audioTrack.id);
      if (seen.has(langCode)) {
        continue;
      }

      seen.add(langCode);
      result.push({
        value: langCode,
        label: format.audioTrack.displayName
      });
    }

    return result.toSorted(byLabel);
  });

  const qualityOptions = $derived.by(() => {
    if (isAudio) {
      const selectedTrackId = props().selectedAudioFormat?.audioTrack?.id ?? null;
      const formats = uniqueAudioLanguages.length > 0
        ? props().audioFormats.filter(format => (format.audioTrack?.id ?? null) === selectedTrackId)
        : props().audioFormats;
      return formats.map(format => ({
        value: `${format.itag}:${format.audioTrack?.id ?? ""}`,
        label: `${Math.floor(format.bitrate / 1000)} kbps (${formatAudioCodecLabel(format.mimeType)})`
      }));
    }

    return props().videoFormats.map(format => ({
      value: format.itag.toString(),
      label: formatVideoQualityLabel(format)
    }));
  });

  const qualityValue = $derived(
    isAudio
      ? `${props().selectedAudioFormat?.itag ?? ""}:${props().selectedAudioFormat?.audioTrack?.id ?? ""}`
      : (props().selectedVideoFormat?.itag.toString() ?? "")
  );

  const captionCustomOptions = $derived(
    props().captionTracks.map(track => ({
      value: track.vssId,
      label: track.name.simpleText
    })).toSorted(byLabel)
  );

  const captionOriginalLabel = $derived.by(() => {
    const originalLangId = findOriginalAudioFormat(props().audioFormats)?.audioTrack?.id;
    if (originalLangId) {
      const langCode = normalizeLanguageCode(originalLangId);
      const match = props().captionTracks.find(
        track => normalizeLanguageCode(track.languageCode) === langCode && !track.kind
      ) ?? props().captionTracks.find(track => normalizeLanguageCode(track.languageCode) === langCode);
      if (match) {
        return match.name.simpleText;
      }
    }

    return props().captionTracks.find(track => !track.kind)?.name.simpleText
      ?? props().captionTracks[0]?.name.simpleText
      ?? null;
  });

  const audioPlayerLabel = $derived(props().selectedAudioFormat?.audioTrack?.displayName ?? null);
  const audioOriginalLabel = $derived(findOriginalAudioFormat(props().audioFormats)?.audioTrack?.displayName ?? null);
  const captionPlayerLabel = $derived(props().selectedCaptionTrack?.name.simpleText ?? null);
  const selectedCaptionVssId = $derived(props().selectedCaptionTrack?.vssId ?? "");

  return {
    get isAudio() {
      return isAudio;
    },
    get uniqueAudioLanguages() {
      return uniqueAudioLanguages;
    },
    get qualityOptions() {
      return qualityOptions;
    },
    get qualityValue() {
      return qualityValue;
    },
    get captionCustomOptions() {
      return captionCustomOptions;
    },
    get captionOriginalLabel() {
      return captionOriginalLabel;
    },
    get audioPlayerLabel() {
      return audioPlayerLabel;
    },
    get audioOriginalLabel() {
      return audioOriginalLabel;
    },
    get captionPlayerLabel() {
      return captionPlayerLabel;
    },
    get selectedCaptionVssId() {
      return selectedCaptionVssId;
    }
  };
}
