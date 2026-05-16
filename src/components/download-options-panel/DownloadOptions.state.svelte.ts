import {
  buildQualityOptions,
  buildUniqueAudioLanguages,
  byLabel,
  resolveCaptionOriginalLabel
} from "./download-options-helpers";
import { PLAYER_ACTIVE_AUDIO, PLAYER_ACTIVE_CAPTION } from "./helpers/player-active-tracks.svelte";
import { preserveAutoVariant } from "./helpers/preserve-auto-variant";
import { optionsItem } from "@/lib/storage/storage";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { findOriginalAudioFormat, INITIAL_OPTIONS } from "@/lib/youtube/video-helpers";
import { DownloadType } from "@/types";
import type { AdaptiveFormatItem, CaptionTrack } from "@/types";

const AUTO_GENERATED_SUFFIX = "(auto-generated)";
const AUTO_DUB_TRACK_SUFFIX = ".10";

function formatCaptionLabel(track: CaptionTrack) {
  const name = track.name.simpleText;
  if (track.kind !== "asr") {
    return name;
  }

  return name.includes(AUTO_GENERATED_SUFFIX) ? name : `${name} ${AUTO_GENERATED_SUFFIX}`;
}

export interface DownloadOptionsProps {
  downloadType: DownloadType;
  videoFormats: AdaptiveFormatItem[];
  audioFormats: AdaptiveFormatItem[];
  captionTracks: CaptionTrack[];
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  selectedCaptionTrack: CaptionTrack | null;
}

const PANEL_OPTIONS = $state({
  includeAiCaptions: CONTENT_OPTIONS.includeAiCaptions,
  includeAutoDubbing: CONTENT_OPTIONS.includeAutoDubbing
});

optionsItem.watch(next => {
  if (!next) {
    return;
  }

  PANEL_OPTIONS.includeAiCaptions = next.includeAiCaptions ?? INITIAL_OPTIONS.includeAiCaptions;
  PANEL_OPTIONS.includeAutoDubbing = next.includeAutoDubbing ?? INITIAL_OPTIONS.includeAutoDubbing;
});

export function createDownloadOptionsState(props: () => DownloadOptionsProps) {
  const isAudio = $derived(props().downloadType === DownloadType.Audio);

  const preservedAutoDubbedLangCode = $derived(
    !PANEL_OPTIONS.includeAutoDubbing && PLAYER_ACTIVE_AUDIO.isAutoDubbed
      ? PLAYER_ACTIVE_AUDIO.langCode
      : null
  );
  const uniqueAudioLanguages = $derived(
    buildUniqueAudioLanguages({
      audioFormats: props().audioFormats,
      includeAutoDubbing: PANEL_OPTIONS.includeAutoDubbing,
      preservedAutoDubbedLangCode
    })
  );

  const filteredCaptionTracks = $derived(
    props().captionTracks.filter(track => preserveAutoVariant({
      item: track,
      isAuto: track => track.kind === "asr",
      matchesPlayer: track => track.vssId === PLAYER_ACTIVE_CAPTION.vssId,
      globalIncludes: PANEL_OPTIONS.includeAiCaptions
    }))
  );

  const qualityOptions = $derived(
    buildQualityOptions({
      isAudio,
      audioFormats: props().audioFormats,
      videoFormats: props().videoFormats,
      selectedAudioTrackId: props().selectedAudioFormat?.audioTrack?.id,
      uniqueAudioLanguagesCount: uniqueAudioLanguages.length
    })
  );

  const qualityValue = $derived(
    isAudio
      ? `${props().selectedAudioFormat?.itag ?? ""}:${props().selectedAudioFormat?.audioTrack?.id ?? ""}`
      : (props().selectedVideoFormat?.itag.toString() ?? "")
  );

  const captionCustomOptions = $derived(
    props().captionTracks
      .filter(track => preserveAutoVariant({
        item: track,
        isAuto: candidate => candidate.kind === "asr",
        matchesPlayer: () => false,
        globalIncludes: PANEL_OPTIONS.includeAiCaptions
      }))
      .map(track => ({
        value: track.vssId,
        label: formatCaptionLabel(track)
      }))
      .toSorted(byLabel)
  );

  const captionOriginalLabel = $derived(
    resolveCaptionOriginalLabel({
      audioFormats: props().audioFormats,
      captionTracks: filteredCaptionTracks
    })
  );
  const audioPlayerLabel = $derived.by(() => {
    const format = props().selectedAudioFormat;
    if (!format?.audioTrack) {
      return null;
    }

    const isAutoDubbed = format.audioTrack.id.endsWith(AUTO_DUB_TRACK_SUFFIX);
    return isAutoDubbed ? `${format.audioTrack.displayName} (auto-dubbed)` : format.audioTrack.displayName;
  });
  const hasExtrasToBundle = $derived.by(() => {
    const selectedTrackId = props().selectedAudioFormat?.audioTrack?.id;
    if (!selectedTrackId) {
      return false;
    }

    return props().audioFormats.some(format => {
      const trackId = format.audioTrack?.id;
      return !!trackId
        && trackId !== selectedTrackId
        && (PANEL_OPTIONS.includeAutoDubbing || !trackId.endsWith(AUTO_DUB_TRACK_SUFFIX));
    });
  });
  const audioOriginalLabel = $derived(findOriginalAudioFormat(props().audioFormats)?.audioTrack?.displayName ?? null);
  const captionPlayerLabel = $derived.by(() => {
    const track = props().selectedCaptionTrack;
    return track ? formatCaptionLabel(track) : null;
  });
  const selectedCaptionVssId = $derived(props().selectedCaptionTrack?.vssId ?? "");

  return {
    get includeAiCaptions() {
      return PANEL_OPTIONS.includeAiCaptions;
    },
    get isAudio() {
      return isAudio;
    },
    get uniqueAudioLanguages() {
      return uniqueAudioLanguages;
    },
    get filteredCaptionTracks() {
      return filteredCaptionTracks;
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
    get hasExtrasToBundle() {
      return hasExtrasToBundle;
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
