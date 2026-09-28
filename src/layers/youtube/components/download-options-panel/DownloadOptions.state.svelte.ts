import {
  buildQualityOptions,
  buildUniqueAudioLanguages,
  byLabel,
  resolveCaptionOriginalLabel
} from "./download-options-helpers";
import { AUTO_DUB_TRACK_SUFFIX, CAPTION_KIND_ASR } from "./helpers/audio-language-helpers";
import { PLAYER_ACTIVE_CAPTION } from "./helpers/player-active-tracks.svelte";
import { preserveAutoVariant } from "./helpers/preserve-auto-variant";
import { optionsItem } from "@/lib/storage/storage";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { normalizeLanguageCode } from "@/lib/youtube/audio-format-helpers";
import { findOriginalAudioFormat, INITIAL_OPTIONS } from "@/lib/youtube/video-helpers";
import { DownloadType } from "@/types";
import type { AdaptiveFormatItem, CaptionTrack, TranslationLanguage } from "@/types";
import { SvelteSet } from "svelte/reactivity";

const TRANSLATED_CAPTION_VSSID_PREFIX = "t.";
const TRANSLATED_CAPTION_LABEL_SUFFIX = "(auto-translated)";

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
  translationLanguages: TranslationLanguage[];
  selectedVideoFormat: AdaptiveFormatItem | null;
  selectedAudioFormat: AdaptiveFormatItem | null;
  selectedCaptionTrack: CaptionTrack | null;
}

let includeAiCaptionsLocal = $state<boolean | null>(null);
let includeAutoDubbingLocal = $state<boolean | null>(null);
let downloadExtrasLocal = $state<boolean | null>(null);
let downloadExtraCaptionsLocal = $state(CONTENT_OPTIONS.downloadExtras);
let isDownloadLocked = false;

export const PANEL_OPTIONS = {
  get includeAiCaptions() {
    return includeAiCaptionsLocal ?? CONTENT_OPTIONS.includeAiCaptions;
  },
  set includeAiCaptions(value: boolean) {
    includeAiCaptionsLocal = value;
  },
  get includeAutoDubbing() {
    return includeAutoDubbingLocal ?? CONTENT_OPTIONS.includeAutoDubbing;
  },
  set includeAutoDubbing(value: boolean) {
    includeAutoDubbingLocal = value;
  },
  get downloadExtras() {
    return downloadExtrasLocal ?? CONTENT_OPTIONS.downloadExtras;
  },
  set downloadExtras(value: boolean) {
    downloadExtrasLocal = value;
  },
  get downloadExtraCaptions() {
    return downloadExtraCaptionsLocal;
  },
  set downloadExtraCaptions(value: boolean) {
    downloadExtraCaptionsLocal = value;
  }
};

export function lockPanelOptions() {
  includeAiCaptionsLocal ??= CONTENT_OPTIONS.includeAiCaptions;
  includeAutoDubbingLocal ??= CONTENT_OPTIONS.includeAutoDubbing;
  downloadExtrasLocal ??= CONTENT_OPTIONS.downloadExtras;
  isDownloadLocked = true;
}

export function unlockPanelOptions() {
  isDownloadLocked = false;
}

optionsItem.watch(next => {
  if (!next || isDownloadLocked) {
    return;
  }

  PANEL_OPTIONS.includeAiCaptions = next.includeAiCaptions ?? INITIAL_OPTIONS.includeAiCaptions;
  PANEL_OPTIONS.includeAutoDubbing = next.includeAutoDubbing ?? INITIAL_OPTIONS.includeAutoDubbing;
  PANEL_OPTIONS.downloadExtras = next.downloadExtras ?? INITIAL_OPTIONS.downloadExtras;
});

export function createDownloadOptionsState(props: () => DownloadOptionsProps) {
  const isAudio = $derived(props().downloadType === DownloadType.Audio);

  const uniqueAudioLanguages = $derived(
    buildUniqueAudioLanguages({
      audioFormats: props().audioFormats,
      includeAutoDubbing: PANEL_OPTIONS.includeAutoDubbing
    })
  );

  const manualCaptionLanguageCodes = $derived(
    new SvelteSet(
      props().captionTracks
        .filter(track => track.kind !== CAPTION_KIND_ASR)
        .map(track => normalizeLanguageCode(track.languageCode))
    )
  );

  function hasManualCounterpart(track: CaptionTrack): boolean {
    return track.kind === CAPTION_KIND_ASR &&
      manualCaptionLanguageCodes.has(normalizeLanguageCode(track.languageCode));
  }

  const filteredCaptionTracks = $derived(
    props().captionTracks
      .filter(track => preserveAutoVariant({
        item: track,
        isAuto: candidate => candidate.kind === CAPTION_KIND_ASR,
        matchesPlayer: candidate => candidate.vssId === PLAYER_ACTIVE_CAPTION.vssId,
        globalIncludes: PANEL_OPTIONS.includeAiCaptions
      }))
      .filter(track => !hasManualCounterpart(track))
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

  const translatedCaptionTracks = $derived.by(() => {
    const { captionTracks, translationLanguages } = props();
    const sourceTrack = captionTracks.find(track => track.isTranslatable);
    const isAiDisabled = !PANEL_OPTIONS.includeAiCaptions || !PANEL_OPTIONS.includeAutoDubbing;
    const isTranslationUnavailable = !sourceTrack || translationLanguages.length === 0 || isAiDisabled;
    if (isTranslationUnavailable) {
      return [];
    }

    const existingLangCodes = new SvelteSet(captionTracks.map(track => normalizeLanguageCode(track.languageCode)));
    return translationLanguages
      .filter(lang => !existingLangCodes.has(normalizeLanguageCode(lang.languageCode)))
      .map(lang => ({
        baseUrl: sourceTrack.baseUrl,
        name: lang.languageName,
        vssId: `${TRANSLATED_CAPTION_VSSID_PREFIX}${lang.languageCode}`,
        languageCode: lang.languageCode,
        isTranslatable: false,
        translationLanguageCode: lang.languageCode,
        sourceTrackVssId: sourceTrack.vssId
      }));
  });

  const captionCustomOptions = $derived.by(() => {
    const nativeOptions = props().captionTracks
      .filter(track => preserveAutoVariant({
        item: track,
        isAuto: candidate => candidate.kind === CAPTION_KIND_ASR,
        matchesPlayer: () => false,
        globalIncludes: PANEL_OPTIONS.includeAiCaptions
      }))
      .filter(track => !hasManualCounterpart(track))
      .map(track => ({
        value: track.vssId,
        label: formatCaptionLabel(track)
      }));

    const translatedOptions = translatedCaptionTracks.map(track => ({
      value: track.vssId,
      label: `${track.name.simpleText} ${TRANSLATED_CAPTION_LABEL_SUFFIX}`
    }));

    return [...nativeOptions, ...translatedOptions].toSorted(byLabel);
  });

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
  const isExtrasToBundle = $derived(audioTracksToBundle.length > 1);
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
    get translatedCaptionTracks() {
      return translatedCaptionTracks;
    },
    get captionOriginalLabel() {
      return captionOriginalLabel;
    },
    get audioPlayerLabel() {
      return audioPlayerLabel;
    },
    get isExtrasToBundle() {
      return isExtrasToBundle;
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
