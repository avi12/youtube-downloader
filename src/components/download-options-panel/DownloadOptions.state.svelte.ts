import {
  buildQualityOptions,
  buildUniqueAudioLanguages,
  byLabel,
  resolveCaptionOriginalLabel
} from "./download-options-helpers";
import { AUTO_DUB_TRACK_SUFFIX, CAPTION_KIND_ASR } from "./helpers/audio-language-helpers";
import { PLAYER_ACTIVE_AUDIO, PLAYER_ACTIVE_CAPTION } from "./helpers/player-active-tracks.svelte";
import { preserveAutoVariant } from "./helpers/preserve-auto-variant";
import { optionsItem } from "@/lib/storage/storage";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { findOriginalAudioFormat, INITIAL_OPTIONS } from "@/lib/youtube/video-helpers";
import { DownloadType } from "@/types";
import type { AdaptiveFormatItem, CaptionTrack } from "@/types";

const AUTO_GENERATED_SUFFIX = "(auto-generated)";
const AUTO_DUBBED_LABEL_SUFFIX = "(auto-dubbed)";

function formatCaptionLabel(track: CaptionTrack) {
  const name = track.name.simpleText;
  if (track.kind !== CAPTION_KIND_ASR) {
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

export const PANEL_OPTIONS = $state({
  includeAiCaptions: CONTENT_OPTIONS.includeAiCaptions,
  includeAutoDubbing: CONTENT_OPTIONS.includeAutoDubbing,
  downloadExtras: CONTENT_OPTIONS.downloadExtras,
  downloadExtraCaptions: CONTENT_OPTIONS.downloadExtras
});

$effect.root(() => {
  $effect(() => {
    PANEL_OPTIONS.includeAiCaptions = CONTENT_OPTIONS.includeAiCaptions;
    PANEL_OPTIONS.includeAutoDubbing = CONTENT_OPTIONS.includeAutoDubbing;
    PANEL_OPTIONS.downloadExtras = CONTENT_OPTIONS.downloadExtras;
  });
});

optionsItem.watch(next => {
  if (!next) {
    return;
  }

  PANEL_OPTIONS.includeAiCaptions = next.includeAiCaptions ?? INITIAL_OPTIONS.includeAiCaptions;
  PANEL_OPTIONS.includeAutoDubbing = next.includeAutoDubbing ?? INITIAL_OPTIONS.includeAutoDubbing;
  PANEL_OPTIONS.downloadExtras = next.downloadExtras ?? INITIAL_OPTIONS.downloadExtras;
});

export function createDownloadOptionsState(props: () => DownloadOptionsProps) {
  const isAudio = $derived(props().downloadType === DownloadType.Audio);

  const isPlayerOnAutoDubbedAndExcluded = $derived(
    !PANEL_OPTIONS.includeAutoDubbing && PLAYER_ACTIVE_AUDIO.isAutoDubbed
  );
  const preservedAutoDubbedLangCode = $derived(
    isPlayerOnAutoDubbedAndExcluded ? PLAYER_ACTIVE_AUDIO.langCode : null
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
      isAuto: candidate => candidate.kind === CAPTION_KIND_ASR,
      matchesPlayer: candidate => candidate.vssId === PLAYER_ACTIVE_CAPTION.vssId,
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
        isAuto: candidate => candidate.kind === CAPTION_KIND_ASR,
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
    return isAutoDubbed ? `${format.audioTrack.displayName} ${AUTO_DUBBED_LABEL_SUFFIX}` : format.audioTrack.displayName;
  });
  const audioTracksToBundle = $derived.by(() => {
    const selected = props().selectedAudioFormat;
    const isNotVideoAndAudio = props().downloadType !== DownloadType.VideoAndAudio;
    if (isNotVideoAndAudio || !selected) {
      return [];
    }

    const selectedTrackId = selected.audioTrack?.id;
    const isExtrasWithTrack = PANEL_OPTIONS.downloadExtras && selectedTrackId;
    if (!isExtrasWithTrack) {
      return [selected];
    }

    const isSelectedAutoDubbed = selectedTrackId.endsWith(AUTO_DUB_TRACK_SUFFIX);
    const isAutoDubbingBlockedForSelected = !PANEL_OPTIONS.includeAutoDubbing && isSelectedAutoDubbed;
    if (isAutoDubbingBlockedForSelected) {
      return [selected];
    }

    const extras = props().audioFormats.filter(format => {
      const trackId = format.audioTrack?.id;
      const isOtherTrack = !!trackId && trackId !== selectedTrackId;
      const isAllowedByDubbingPref = PANEL_OPTIONS.includeAutoDubbing || !trackId?.endsWith(AUTO_DUB_TRACK_SUFFIX);
      return isOtherTrack && isAllowedByDubbingPref;
    });

    return [selected, ...extras];
  });
  const hasExtrasToBundle = $derived(audioTracksToBundle.length > 1);
  const audioOriginalLabel = $derived(findOriginalAudioFormat(props().audioFormats)?.audioTrack?.displayName ?? null);
  const captionPlayerLabel = $derived.by(() => {
    const track = props().selectedCaptionTrack;
    return track ? formatCaptionLabel(track) : null;
  });
  const selectedCaptionVssId = $derived(props().selectedCaptionTrack?.vssId ?? "");

  function setDownloadExtras(value: boolean) {
    PANEL_OPTIONS.downloadExtras = value;
  }

  function setDownloadExtraCaptions(value: boolean) {
    PANEL_OPTIONS.downloadExtraCaptions = value;
  }

  return {
    get includeAiCaptions() {
      return PANEL_OPTIONS.includeAiCaptions;
    },
    get downloadExtras() {
      return PANEL_OPTIONS.downloadExtras;
    },
    setDownloadExtras,
    get downloadExtraCaptions() {
      return PANEL_OPTIONS.downloadExtraCaptions;
    },
    setDownloadExtraCaptions,
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
