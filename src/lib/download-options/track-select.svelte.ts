import { MULTI_TRACK_UNSUPPORTED_EXTENSIONS } from "@/lib/utils/containers";
import { DownloadType, PanelTrackMode } from "@/types";
import type { CaptionTrack, LabeledOption } from "@/types";

const AUDIO_AUTO = "auto";
const CAPTION_AUTO = "auto";
const CAPTION_OFF = "off";

export type TrackSelectProps = {
  downloadType: DownloadType;
  extension: string;
  uniqueAudioLanguages: LabeledOption[];
  captionTracks: CaptionTrack[];
  panelAudioMode: PanelTrackMode;
  panelAudioCustomLanguage: string;
  audioOriginalLabel: string | null;
  panelCaptionMode: PanelTrackMode;
  captionCustomOptions: LabeledOption[];
  captionOriginalLabel: string | null;
  selectedCaptionVssId: string;
  audioPlayerLabel: string | null;
  captionPlayerLabel: string | null;
  onaudiomodechange: (mode: PanelTrackMode) => void;
  onaudiocustomchange: (langCode: string) => void;
  oncaptionmodechange: (mode: PanelTrackMode) => void;
  oncaptionchange: (vssId: string) => void;
};

function moveToFront<Option>(options: Option[], isFront: (option: Option) => boolean) {
  const sorted = [...options];
  const frontIndex = sorted.findIndex(isFront);
  if (frontIndex > 0) {
    sorted.unshift(...sorted.splice(frontIndex, 1));
  }

  return sorted;
}

export function createTrackSelectState(props: () => TrackSelectProps) {
  const isAudioOnly = $derived(props().downloadType === DownloadType.Audio);
  const isVideoOnly = $derived(props().downloadType === DownloadType.Video);
  const isExtensionMultiTrackIncompatible = $derived(MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(props().extension));
  const isAudioTrackSelectorPresent = $derived(props().uniqueAudioLanguages.length > 1);
  const isCaptionsPresent = $derived(props().captionTracks.length > 0);
  const isCaptionSelectorPresent = $derived(isCaptionsPresent && !isVideoOnly && !isAudioOnly);
  const isSingleCaptionOption = $derived(props().captionCustomOptions.length === 1);

  const originalAudioLangCode = $derived(
    props().uniqueAudioLanguages.find(language => language.label === props().audioOriginalLabel)?.value ?? null
  );

  const audioSelectValue = $derived.by(() => {
    const { panelAudioMode, panelAudioCustomLanguage } = props();
    if (panelAudioMode === PanelTrackMode.MatchVideo) {
      return AUDIO_AUTO;
    }

    if (panelAudioMode === PanelTrackMode.Original) {
      return originalAudioLangCode ?? AUDIO_AUTO;
    }

    return panelAudioCustomLanguage || AUDIO_AUTO;
  });

  const captionSelectValue = $derived.by(() => {
    const { panelCaptionMode, captionCustomOptions, selectedCaptionVssId } = props();
    if (panelCaptionMode === PanelTrackMode.MatchVideo) {
      if (isSingleCaptionOption) {
        return captionCustomOptions[0]!.value;
      }

      return CAPTION_AUTO;
    }

    return selectedCaptionVssId || CAPTION_OFF;
  });

  const audioOptions = $derived([
    {
      value: AUDIO_AUTO,
      label: props().audioPlayerLabel ? `Auto · ${props().audioPlayerLabel}` : "Auto"
    },
    ...moveToFront(props().uniqueAudioLanguages, language => language.value === originalAudioLangCode)
      .map(language => ({
        value: language.value,
        label: language.value === originalAudioLangCode ? `${language.label} · Original` : language.label
      }))
  ]);

  const captionOptions = $derived([
    ...(isSingleCaptionOption ? [] : [{
      value: CAPTION_AUTO,
      label: props().captionPlayerLabel ? `Auto · ${props().captionPlayerLabel}` : "Auto"
    }]),
    {
      value: CAPTION_OFF,
      label: "No captions"
    },
    ...moveToFront(props().captionCustomOptions, option => option.label === props().captionOriginalLabel)
  ]);

  const audioSummaryText = $derived.by(() => {
    if (!isAudioTrackSelectorPresent) {
      return null;
    }

    if (audioSelectValue === AUDIO_AUTO) {
      return "Audio: matches player";
    }

    const label = props().uniqueAudioLanguages.find(language => language.value === audioSelectValue)?.label;
    return label ? `Audio: ${label}` : null;
  });

  const captionSummaryText = $derived.by(() => {
    if (!isCaptionSelectorPresent) {
      return null;
    }

    if (captionSelectValue === CAPTION_AUTO) {
      return "Captions: matches player";
    }

    if (captionSelectValue === CAPTION_OFF) {
      return "No captions";
    }

    const label = props().captionCustomOptions.find(option => option.value === captionSelectValue)?.label;
    return label ? `Captions: ${label}` : null;
  });

  function handleAudioChange(value: string) {
    if (value === AUDIO_AUTO) {
      props().onaudiomodechange(PanelTrackMode.MatchVideo);
      return;
    }

    props().onaudiomodechange(PanelTrackMode.Custom);
    props().onaudiocustomchange(value);
  }

  function handleCaptionChange(value: string) {
    if (value === CAPTION_AUTO) {
      props().oncaptionmodechange(PanelTrackMode.MatchVideo);
      return;
    }

    if (value === CAPTION_OFF) {
      props().oncaptionmodechange(PanelTrackMode.Custom);
      props().oncaptionchange("");
      return;
    }

    props().oncaptionmodechange(PanelTrackMode.Custom);
    props().oncaptionchange(value);
  }

  return {
    get isAudioOnly() {
      return isAudioOnly;
    },
    get isExtensionMultiTrackIncompatible() {
      return isExtensionMultiTrackIncompatible;
    },
    get isAudioTrackSelectorPresent() {
      return isAudioTrackSelectorPresent;
    },
    get isCaptionSelectorPresent() {
      return isCaptionSelectorPresent;
    },
    get isVisible() {
      return isAudioTrackSelectorPresent || isCaptionSelectorPresent;
    },
    get isExtrasToggleShown() {
      return isAudioTrackSelectorPresent && !isAudioOnly && !isVideoOnly;
    },
    get isExtraCaptionsToggleShown() {
      return captionSelectValue !== CAPTION_OFF && props().captionCustomOptions.length > 1;
    },
    get audioSelectValue() {
      return audioSelectValue;
    },
    get captionSelectValue() {
      return captionSelectValue;
    },
    get audioOptions() {
      return audioOptions;
    },
    get captionOptions() {
      return captionOptions;
    },
    get summaryMeta() {
      return [audioSummaryText, captionSummaryText].filter(Boolean).join("  ·  ");
    },
    handleAudioChange,
    handleCaptionChange
  };
}
