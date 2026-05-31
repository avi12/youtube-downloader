<script lang="ts">
  import type { createPlaylistGridItemState } from "./PlaylistGridItem.state.svelte";
  import {
    formatExtensionLabel
  } from "@/components/playlist-downloader/helpers/PlaylistDownloaderFormatSections.helpers";
  import PolymerSelect from "@/components/polymer-select/PolymerSelect.svelte";
  import { onButtonClick } from "@/lib/messaging/cross-world-messenger";
  import { attachSettingsOptions, DATA_BUTTON_ID_ATTR, sendButtonData } from "@/lib/ui/polymer-utils";
  import { supportedExtensions } from "@/lib/utils/containers";
  import { VIDEO_QUALITIES } from "@/lib/youtube/options-defaults";
  import {
    ButtonSize,
    ButtonState,
    ButtonStyle,
    ButtonType,
    DownloadType,
    IconName,
    PlaylistOutputMode,
    VideoQualityMode
  } from "@/types";
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { slide } from "svelte/transition";

  const OUTPUT_ID_PREFIX = "playlist-grid-output-";
  const OUTPUT_ID_INDIVIDUAL_SUFFIX = "-individual";
  const OUTPUT_ID_ZIP_SUFFIX = "-zip";
  const OUTPUT_SETTINGS_TITLE = "Output";

  const downloadTypeOptions = [
    {
      value: DownloadType.Auto,
      label: "Auto (match each item)"
    },
    {
      value: DownloadType.VideoAndAudio,
      label: "Video + audio"
    },
    {
      value: DownloadType.Video,
      label: "Video only"
    },
    {
      value: DownloadType.Audio,
      label: "Audio only"
    }
  ];

  interface Props {
    playlistId: string;
    state: ReturnType<typeof createPlaylistGridItemState>;
  }

  const { playlistId, state }: Props = $props();
  const initialPlaylistId = untrack(() => playlistId);

  type OutputButton = {
    id: string;
    label: string;
    tooltip: string;
    mode: PlaylistOutputMode;
  };

  const outputButtons: OutputButton[] = [
    {
      id: `${OUTPUT_ID_PREFIX}${initialPlaylistId}${OUTPUT_ID_INDIVIDUAL_SUFFIX}`,
      label: "Separate files",
      tooltip: "Save as separate files",
      mode: PlaylistOutputMode.Individual
    },
    {
      id: `${OUTPUT_ID_PREFIX}${initialPlaylistId}${OUTPUT_ID_ZIP_SUFFIX}`,
      label: "Single ZIP",
      tooltip: "Bundle into one ZIP",
      mode: PlaylistOutputMode.Zip
    }
  ];

  const outputElements = new SvelteMap<string, HTMLElement>();

  function refreshOutputButton(button: OutputButton): void {
    const elButton = outputElements.get(button.id);
    if (!elButton) {
      return;
    }

    elButton.setAttribute(DATA_BUTTON_ID_ATTR, button.id);

    const isActive = state.effectiveOutputMode === button.mode;
    const isDisabled = state.isWorking;

    sendButtonData({
      elButton,
      data: {
        iconName: IconName.None,
        title: button.label,
        accessibilityText: button.label,
        style: isActive ? ButtonStyle.Overlay : ButtonStyle.Mono,
        type: isActive ? ButtonType.Filled : ButtonType.Outline,
        buttonSize: ButtonSize.XSmall,
        state: isDisabled ? ButtonState.Disabled : ButtonState.Active,
        isFullWidth: false,
        isDisabled,
        tooltip: button.tooltip
      },
      a11y: {
        tabIndex: isActive ? 0 : -1,
        role: "radio",
        ariaChecked: String(isActive)
      }
    });
  }

  function refreshOutputButtons(): void {
    for (const button of outputButtons) {
      refreshOutputButton(button);
    }
  }

  function createOutputAttacher(button: OutputButton): (elButton: Element) => void {
    return elButton => {
      if (!(elButton instanceof HTMLElement)) {
        return;
      }

      outputElements.set(button.id, elButton);
      refreshOutputButton(button);
    };
  }

  function handleOutputClick(buttonId: string): void {
    const match = outputButtons.find(button => button.id === buttonId);
    if (!match) {
      return;
    }

    state.effectiveOutputMode = match.mode;
  }

  function handleOutputKeydown(e: KeyboardEvent): void {
    const isArrowKey = e.key === "ArrowLeft" || e.key === "ArrowRight";
    if (!isArrowKey) {
      return;
    }

    e.preventDefault();
    const iCurrent = outputButtons.findIndex(button => state.effectiveOutputMode === button.mode);
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const iNext = (iCurrent + delta + outputButtons.length) % outputButtons.length;
    const nextButton = outputButtons[iNext];
    state.effectiveOutputMode = nextButton.mode;
    const elNext = outputElements.get(nextButton.id);
    queueMicrotask(() => elNext?.querySelector<HTMLButtonElement>("button")?.focus());
  }

  $effect.pre(() => {
    void state.effectiveOutputMode;
    void state.isWorking;
    refreshOutputButtons();
  });

  $effect(() => onButtonClick(buttonId => {
    untrack(() => handleOutputClick(buttonId));
  }));

  const qualityOptions = $derived.by(() => {
    const heights = state.availableQualities.length > 0 ? state.availableQualities : VIDEO_QUALITIES;
    return [
      {
        value: VideoQualityMode.Best,
        label: "Best quality"
      },
      ...heights.map(height => ({
        value: String(height),
        label: state.isMetadataLoaded && height <= state.guaranteedQuality
          ? `${height}p`
          : `Up to ${height}p`
      }))
    ];
  });

  const videoExtOptions = $derived(
    supportedExtensions.video.map(extension => ({
      value: extension,
      label: formatExtensionLabel(extension)
    }))
  );

  const audioExtOptions = $derived(
    supportedExtensions.audio.map(extension => ({
      value: extension,
      label: formatExtensionLabel(extension)
    }))
  );

  function handleZipNameInput(e: Event): void {
    const isInputElement = e.target instanceof HTMLInputElement;
    if (isInputElement) {
      state.effectiveZipName = e.target.value;
      return;
    }

    const elPaperInput = e.currentTarget;
    if (elPaperInput && "value" in elPaperInput && typeof elPaperInput.value === "string") {
      state.effectiveZipName = elPaperInput.value;
    }
  }

  function applyPaperInputTheme(elTarget: Element): void {
    const elInput = elTarget.querySelector("input");
    if (elInput) {
      elInput.dir = "auto";
    }
  }
</script>

<div class="ytdl-section">
  <PolymerSelect
    id="playlist-grid-download-type-{playlistId}"
    disabled={state.isWorking}
    label="Download type"
    onchange={value => (state.effectiveDownloadType = value as DownloadType)}
    options={downloadTypeOptions}
    value={state.effectiveDownloadType}
  />
</div>

<ytd-settings-options-renderer class="ytdl-section" {@attach attachSettingsOptions(OUTPUT_SETTINGS_TITLE)}>
  <div
    class="ytdl-seg"
    aria-label="Output"
    onkeydown={handleOutputKeydown}
    role="radiogroup"
    tabindex="-1"
  >
    {#each outputButtons as button (button.id)}
      <yt-button-view-model
        {@attach createOutputAttacher(button)}
        data-ytdl-button-id={button.id}
      ></yt-button-view-model>
    {/each}
  </div>
</ytd-settings-options-renderer>

{#if state.effectiveOutputMode === PlaylistOutputMode.Zip}
  <div class="ytdl-zip-row" transition:slide>
    <tp-yt-paper-input
      id="ytdl-grid-zip-name-input-{playlistId}"
      {@attach applyPaperInputTheme}
      autocomplete="off"
      disabled={state.isWorking || undefined}
      label="Filename"
      oninput={handleZipNameInput}
      spellcheck={false}
      value={state.effectiveZipName}
    ></tp-yt-paper-input>
    <span class="ytdl-zip-ext-label" aria-hidden="true">.zip</span>
  </div>
{/if}

{#if state.effectiveDownloadType !== DownloadType.Audio}
  <div class="ytdl-grid">
    <PolymerSelect
      id="playlist-grid-quality-{playlistId}"
      disabled={state.isWorking}
      label="Quality"
      onchange={value => (state.effectiveQuality = value)}
      options={qualityOptions}
      value={state.effectiveQuality}
    />
    <PolymerSelect
      id="playlist-grid-video-ext-{playlistId}"
      disabled={state.isWorking}
      label="Video format"
      onchange={value => (state.effectiveVideoExt = value)}
      options={videoExtOptions}
      value={state.effectiveVideoExt}
    />
  </div>
{/if}

{#if state.effectiveDownloadType !== DownloadType.Video}
  <div class="ytdl-section ytdl-audio-format-section">
    <PolymerSelect
      id="playlist-grid-audio-ext-{playlistId}"
      disabled={state.isWorking}
      label="Audio format"
      onchange={value => (state.effectiveAudioExt = value)}
      options={audioExtOptions}
      value={state.effectiveAudioExt}
    />
  </div>
{/if}

<p
  class="ytdl-reset-wrapper"
  class:is-visible={state.isAnyOverrideActive}
  inert={!state.isAnyOverrideActive}
>
  <button
    class="ytdl-reset-link"
    disabled={state.isWorking}
    onclick={state.resetOverrides}
    type="button"
  >
    Reset to my defaults
  </button>
</p>

<style>
  .ytdl-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
    margin-top: 16px;
  }

  .ytdl-audio-format-section {
    margin-top: 16px;
  }

  .ytdl-zip-row {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    margin-top: -8px;
  }

  tp-yt-paper-input {
    flex: 1;
    min-width: 0;
  }

  .ytdl-zip-ext-label {
    flex-shrink: 0;
    padding-block-end: 8px;
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-size: 1.4rem;
    user-select: none;
  }

  :global {
    [id^="ytdl-grid-zip-name-input-"] {
      label {
        color: var(--yt-sys-color-baseline--text-secondary, #606060) !important;
      }

      &[focused] label {
        color: var(--yt-sys-color-baseline--call-to-action, #065fd4) !important;
      }

      tp-yt-paper-input-container {
        padding-bottom: 0;
      }
    }
  }

  .ytdl-reset-wrapper {
    display: grid;
    grid-template-rows: 0fr;
    overflow: clip;
    width: fit-content;
    margin-top: 16px;
    transition: grid-template-rows 200ms ease;

    &.is-visible {
      grid-template-rows: 1fr;
    }
  }

  .ytdl-reset-link {
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--yt-sys-color-baseline--call-to-action, #3ea6ff);
    font-family: inherit;
    font-size: 1.2rem;
    cursor: pointer;

    &:hover {
      text-decoration: underline;
    }
  }
</style>
