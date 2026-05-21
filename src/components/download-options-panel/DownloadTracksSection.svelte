<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import { PLAYER_ACTIVE_AUDIO, PLAYER_ACTIVE_CAPTION } from "./helpers/player-active-tracks.svelte";
  import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { attachTracksHeaderButton as attachTracksHeaderButtonUtil } from "@/lib/ui/panel-button-attachments.svelte";
  import { MULTI_TRACK_UNSUPPORTED_EXTENSIONS } from "@/lib/utils/containers";
  import { DownloadType, PanelTrackMode } from "@/types";
  import type { CaptionTrack, LabeledOption } from "@/types";

  interface Props {
    downloadType: DownloadType;
    extension: string;
    uniqueAudioLanguages: LabeledOption[];
    captionTracks: CaptionTrack[];
    isDownloading: boolean;
    downloadExtras: boolean;
    downloadExtraCaptions: boolean;
    isExtrasAutoDisabled: boolean;
    panelAudioMode: PanelTrackMode;
    panelAudioCustomLanguage: string;
    audioOriginalLabel: string | null;
    panelCaptionMode: PanelTrackMode;
    captionCustomOptions: LabeledOption[];
    captionOriginalLabel: string | null;
    selectedCaptionVssId: string;
    onaudiomodechange: (mode: PanelTrackMode) => void;
    onaudiocustomchange: (langCode: string) => void;
    oncaptionmodechange: (mode: PanelTrackMode) => void;
    oncaptionchange: (vssId: string) => void;
    ondownloadextraschange: (value: boolean) => void;
    ondownloadextracaptionschange: (value: boolean) => void;
  }

  const {
    downloadType,
    extension,
    uniqueAudioLanguages,
    captionTracks,
    isDownloading,
    downloadExtras,
    downloadExtraCaptions,
    isExtrasAutoDisabled,
    panelAudioMode,
    panelAudioCustomLanguage,
    audioOriginalLabel,
    panelCaptionMode,
    captionCustomOptions,
    captionOriginalLabel,
    selectedCaptionVssId,
    onaudiomodechange,
    onaudiocustomchange,
    oncaptionmodechange,
    oncaptionchange,
    ondownloadextraschange,
    ondownloadextracaptionschange
  }: Props = $props();

  const AUDIO_AUTO = "auto";
  const CAPTION_AUTO = "auto";
  const CAPTION_OFF = "off";
  const TRACKS_HEADER_BUTTON_ID = "ytdl-tracks-header-btn";
  const scopingClass = document.querySelector("[data-ytdl-download-group] yt-button-view-model, yt-button-view-model")?.getAttribute("class") ?? "";

  const isAudioOnly = $derived(downloadType === DownloadType.Audio);
  const isVideoOnly = $derived(downloadType === DownloadType.Video);
  const isExtensionMultiTrackIncompatible = $derived(MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(extension));
  const hasAudioTrackSelector = $derived(uniqueAudioLanguages.length > 0);
  const hasMultipleAudioTracks = $derived(uniqueAudioLanguages.length > 1);
  const hasCaptions = $derived(captionTracks.length > 0);
  const isVisible = $derived(hasAudioTrackSelector || (hasCaptions && !isVideoOnly && !isAudioOnly));

  const originalAudioLangCode = $derived(
    uniqueAudioLanguages.find(language => language.label === audioOriginalLabel)?.value ?? null
  );

  const playerAudioLabel = $derived(
    uniqueAudioLanguages.find(language => language.value === PLAYER_ACTIVE_AUDIO.langCode)?.label ?? null
  );

  const playerCaptionLabel = $derived(
    captionCustomOptions.find(option => option.value === PLAYER_ACTIVE_CAPTION.vssId)?.label ?? null
  );

  const audioSelectValue = $derived.by(() => {
    if (panelAudioMode === PanelTrackMode.MatchVideo) {
      return AUDIO_AUTO;
    }

    if (panelAudioMode === PanelTrackMode.Original) {
      return originalAudioLangCode ?? AUDIO_AUTO;
    }

    return panelAudioCustomLanguage || AUDIO_AUTO;
  });

  const captionSelectValue = $derived.by(() => {
    if (panelCaptionMode === PanelTrackMode.MatchVideo) {
      return CAPTION_AUTO;
    }

    return selectedCaptionVssId || CAPTION_OFF;
  });

  const sortedAudioLanguages = $derived.by(() => {
    const languages = [...uniqueAudioLanguages];
    const originalIndex = languages.findIndex(language => language.value === originalAudioLangCode);
    if (originalIndex > 0) {
      const [originalLanguage] = languages.splice(originalIndex, 1);
      languages.unshift(originalLanguage);
    }

    return languages;
  });

  const sortedCaptionCustomOptions = $derived.by(() => {
    const options = [...captionCustomOptions];
    const originalIndex = options.findIndex(option => option.label === captionOriginalLabel);
    if (originalIndex > 0) {
      const [originalOption] = options.splice(originalIndex, 1);
      options.unshift(originalOption);
    }

    return options;
  });

  const audioOptions = $derived([
    {
      value: AUDIO_AUTO,
      label: playerAudioLabel ? `Auto · ${playerAudioLabel}` : "Auto · match player track"
    },
    ...sortedAudioLanguages.map(language => ({
      value: language.value,
      label: language.value === originalAudioLangCode ? `${language.label} · Original` : language.label
    }))
  ]);

  const captionOptions = $derived([
    {
      value: CAPTION_AUTO,
      label: playerCaptionLabel ? `Auto · ${playerCaptionLabel}` : "Auto · match player track"
    },
    {
      value: CAPTION_OFF,
      label: "No captions"
    },
    ...sortedCaptionCustomOptions
  ]);

  const audioSummaryText = $derived.by(() => {
    if (!hasAudioTrackSelector) {
      return null;
    }

    if (audioSelectValue === AUDIO_AUTO) {
      return "Audio: matches player";
    }

    const label = uniqueAudioLanguages.find(language => language.value === audioSelectValue)?.label;
    return label ? `Audio: ${label}` : null;
  });

  const captionSummaryText = $derived.by(() => {
    if (isAudioOnly || isVideoOnly || !hasCaptions) {
      return null;
    }

    if (captionSelectValue === CAPTION_AUTO) {
      return "Captions: matches player";
    }

    if (captionSelectValue === CAPTION_OFF) {
      return "No captions";
    }

    const label = captionCustomOptions.find(option => option.value === captionSelectValue)?.label;
    return label ? `Captions: ${label}` : null;
  });

  const summaryMeta = $derived([audioSummaryText, captionSummaryText].filter(Boolean).join("  ·  "));

  let isOpen = $state(false);

  $effect(() => onButtonClick(buttonId => {
    if (buttonId === TRACKS_HEADER_BUTTON_ID) {
      isOpen = !isOpen;
    }
  }));

  function attachTracksHeaderButton(elButton: Element): void {
    attachTracksHeaderButtonUtil({
      elButton,
      getIsOpen: () => isOpen,
      getIsDownloading: () => isDownloading,
      getIsAudioOnly: () => isAudioOnly,
      getSummaryMeta: () => summaryMeta
    });
  }

  function handleAudioChange(value: string): void {
    if (value === AUDIO_AUTO) {
      onaudiomodechange(PanelTrackMode.MatchVideo);
      return;
    }

    onaudiomodechange(PanelTrackMode.Custom);
    onaudiocustomchange(value);
  }

  function handleCaptionChange(value: string): void {
    if (value === CAPTION_AUTO) {
      oncaptionmodechange(PanelTrackMode.MatchVideo);
      return;
    }

    if (value === CAPTION_OFF) {
      oncaptionmodechange(PanelTrackMode.Custom);
      oncaptionchange("");
      return;
    }

    oncaptionmodechange(PanelTrackMode.Custom);
    oncaptionchange(value);
  }
</script>

<div class="ytdl-tracks-section-host" class:is-open={isVisible}>
  <div class="ytdl-tracks-wrapper">
    <yt-button-view-model
      class={scopingClass}
      {@attach attachTracksHeaderButton}
      aria-expanded={isOpen}
      data-ytdl-button-id={TRACKS_HEADER_BUTTON_ID}
      role="button"
      tabindex={isDownloading ? undefined : 0}
    ></yt-button-view-model>

    <div class="ytdl-tracks-body" class:is-open={isOpen}>
      <div class="ytdl-tracks-body-inner">
        {#if hasAudioTrackSelector}
          <div class="ytdl-track-field">
            <PolymerSelect
              id="tracks-audio-select"
              disabled={isDownloading}
              label="Audio language"
              onchange={handleAudioChange}
              options={audioOptions}
              value={audioSelectValue}
            />
            {#if !isAudioOnly && hasMultipleAudioTracks}
              <tp-yt-paper-toggle-button
                aria-label="Include all audio tracks"
                checked={downloadExtras ? "" : undefined}
                disabled={isDownloading || isExtensionMultiTrackIncompatible ? "" : undefined}
                onchange={e => {
                  if (e.target instanceof HTMLElement) {
                    ondownloadextraschange(e.target.hasAttribute("checked"));
                  }
                }}
              >Include all audio tracks</tp-yt-paper-toggle-button>
              <div class="ytdl-extras-error-host" class:is-open={isExtrasAutoDisabled}>
                <p class="ytdl-extras-error">AVI doesn't support multiple audio tracks</p>
              </div>
            {/if}
          </div>
        {/if}

        {#if hasCaptions && !isAudioOnly && !isVideoOnly}
          <div class="ytdl-track-field">
            <PolymerSelect
              id="tracks-caption-select"
              disabled={isDownloading}
              label="Captions"
              onchange={handleCaptionChange}
              options={captionOptions}
              value={captionSelectValue}
            />
            {#if captionSelectValue !== CAPTION_OFF}
              <tp-yt-paper-toggle-button
                aria-label="Include all captions"
                checked={downloadExtraCaptions ? "" : undefined}
                disabled={isDownloading ? "" : undefined}
                onchange={e => {
                  if (e.target instanceof HTMLElement) {
                    ondownloadextracaptionschange(e.target.hasAttribute("checked"));
                  }
                }}
              >Include all captions</tp-yt-paper-toggle-button>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .ytdl-tracks-section-host {
    display: grid;
    grid-template-rows: minmax(0, 0fr);
    overflow: hidden;
    transition: grid-template-rows 300ms cubic-bezier(0.33, 1, 0.68, 1);

    &.is-open {
      grid-template-rows: minmax(0, 1fr);
    }
  }

  .ytdl-tracks-wrapper {
    overflow: hidden;
    min-height: 0;
    padding-top: 16px;
  }

  .ytdl-tracks-body {
    display: grid;
    grid-template-rows: minmax(0, 0fr);
    overflow: hidden;
    transition: grid-template-rows 220ms ease;

    &.is-open {
      grid-template-rows: minmax(0, 1fr);
      border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
      border-top: none;
      border-bottom-right-radius: 10px;
      border-bottom-left-radius: 10px;
    }
  }

  .ytdl-tracks-body-inner {
    display: flex;
    flex-direction: column;
    gap: 24px;
    overflow: hidden;
    min-height: 0;
    padding: 14px;
  }

  .ytdl-track-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  :global(tp-yt-paper-toggle-button) {
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    font-size: 1.3rem;
  }

  .ytdl-extras-error-host {
    display: grid;
    grid-template-rows: minmax(0, 0fr);
    overflow: hidden;
    transition: grid-template-rows 220ms ease;

    &.is-open {
      grid-template-rows: minmax(0, 1fr);
    }
  }

  .ytdl-extras-error {
    margin: 0;
    padding-top: 4px;
    color: var(--yt-sys-color-baseline--text-error, #d93025);
    font-size: 1.2rem;
  }
</style>
