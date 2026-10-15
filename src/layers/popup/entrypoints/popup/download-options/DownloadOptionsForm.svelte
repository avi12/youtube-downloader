<script lang="ts">
  import downloadIcon from "../icons/download.svg?raw";
  import SettingsSwitch from "../settings/ui/SettingsSwitch.svelte";
  import OptionField from "./OptionField.svelte";
  import OptionSelect from "./OptionSelect.svelte";
  import {
    DOWNLOAD_TYPES,
    findAudioFormatByValue,
    handleQualityChange
  } from "@/lib/download-options/download-options-helpers";
  import { createDownloadOptionsState } from "@/lib/download-options/DownloadOptions.state.svelte.ts";
  import { createPanelState } from "@/lib/download-options/DownloadOptionsPanel.state.svelte.ts";
  import { createOutputSelectState } from "@/lib/download-options/output-select.svelte.ts";
  import type { PanelHost } from "@/lib/download-options/panel-host";
  import { createTrackSelectState } from "@/lib/download-options/track-select.svelte.ts";
  import { getCompatibleFilename } from "@/lib/utils/containers";
  import type { AdaptiveFormatItem, VideoData } from "@/types";
  import { untrack } from "svelte";

  interface Props {
    videoData: VideoData;
    host: PanelHost;
  }

  const props: Props = $props();

  const panel = createPanelState(() => props.videoData, untrack(() => props.host));
  const options = createDownloadOptionsState(() => ({
    downloadType: panel.downloadType,
    videoFormats: props.videoData.videoFormats,
    videoFormatVariants: props.videoData.videoFormatVariants,
    actualExtension: panel.actualExtension,
    codecPreferences: panel.codecPreferences,
    audioFormats: props.videoData.audioFormats,
    captionTracks: props.videoData.captionTracks,
    translationLanguages: props.videoData.translationLanguages,
    selectedVideoFormat: panel.selectedVideoFormat,
    selectedAudioFormat: panel.selectedAudioFormat,
    selectedCaptionTrack: panel.caption.selectedCaptionTrack
  }));
  const tracks = createTrackSelectState(() => ({
    downloadType: panel.downloadType,
    extension: panel.extension,
    uniqueAudioLanguages: options.uniqueAudioLanguages,
    captionTracks: options.filteredCaptionTracks,
    panelAudioMode: panel.audio.panelAudioMode,
    panelAudioCustomLanguage: panel.audio.panelAudioCustomLanguage,
    audioOriginalLabel: options.audioOriginalLabel,
    panelCaptionMode: panel.caption.panelCaptionMode,
    captionCustomOptions: options.captionCustomOptions,
    captionOriginalLabel: options.captionOriginalLabel,
    selectedCaptionVssId: options.selectedCaptionVssId,
    audioPlayerLabel: options.audioPlayerLabel,
    captionPlayerLabel: options.captionPlayerLabel,
    onaudiomodechange: panel.audio.handlePanelAudioModeChange,
    onaudiocustomchange: panel.audio.handlePanelAudioCustomChange,
    oncaptionmodechange: panel.caption.handlePanelCaptionModeChange,
    oncaptionchange: vssId => panel.caption.handleCaptionChange(options.findCaptionTrack(vssId))
  }));
  const output = createOutputSelectState(() => ({
    filename: panel.filename,
    extension: panel.extension,
    actualExtension: panel.actualExtension,
    downloadType: panel.downloadType,
    isMultiTrack: false
  }));

  $effect(() => {
    panel.isFilenameValid = output.isFilenameValid;
  });

  function selectAudioFormat(format: AdaptiveFormatItem): void {
    panel.selectedAudioFormat = format;
  }

  // The popup is too short for the whole form, so bring its top into view once the formats load
  function revealForm(elForm: Element): void {
    elForm.scrollIntoView({ block: "nearest" });
  }

  function changeQuality(valueString: string, isAudio: boolean): void {
    handleQualityChange({
      valueString,
      isAudio,
      audioFormats: props.videoData.audioFormats,
      videoFormatVariants: options.videoFormatVariants,
      onaudioformatchange: selectAudioFormat,
      onvideoformatchange: format => (panel.selectedVideoFormat = format)
    });
  }
</script>

<div class="options-form" {@attach revealForm}>
  <div class="options-grid">
    <OptionSelect
      choices={DOWNLOAD_TYPES}
      label="Type"
      onchange={panel.handleDownloadTypeChange}
      value={panel.downloadType}
    />
    <OptionSelect
      choices={options.qualityOptions}
      label="Quality"
      onchange={valueString => changeQuality(valueString, options.isAudio)}
      value={options.qualityValue}
    />
    {#if options.videoCodecOptions.length > 0}
      <OptionSelect
        choices={options.videoCodecOptions}
        label="Video codec"
        onchange={valueString => changeQuality(valueString, false)}
        value={options.videoCodecValue}
      />
    {/if}
    {#if options.audioCodecOptions.length > 0}
      <OptionSelect
        choices={options.audioCodecOptions}
        label="Audio quality"
        onchange={valueString => {
          const format = findAudioFormatByValue({
            audioFormats: props.videoData.audioFormats,
            valueString
          });
          if (format) {
            selectAudioFormat(format);
          }
        }}
        value={options.audioCodecValue}
      />
    {/if}
  </div>

  {#if tracks.isVisible}
    <div class="options-group">
      {#if tracks.isAudioTrackSelectorPresent}
        <OptionSelect
          choices={tracks.audioOptions}
          label="Audio language"
          onchange={tracks.handleAudioChange}
          value={tracks.audioSelectValue}
        />
        {#if tracks.isExtrasToggleShown}
          <label class="options-toggle">
            Include all audio tracks
            <SettingsSwitch
              isChecked={options.downloadExtras}
              isDisabled={tracks.isExtensionMultiTrackIncompatible}
              onchange={options.setDownloadExtras}
            />
          </label>
          {#if options.isExtrasAutoDisabled}
            <p class="options-error">{panel.extension.toUpperCase()} doesn't support multiple audio tracks</p>
          {/if}
        {/if}
      {/if}
      {#if tracks.isCaptionSelectorPresent}
        <OptionSelect
          choices={tracks.captionOptions}
          label="Captions"
          onchange={tracks.handleCaptionChange}
          value={tracks.captionSelectValue}
        />
        {#if tracks.isExtraCaptionsToggleShown}
          <label class="options-toggle">
            Include all captions
            <SettingsSwitch isChecked={options.downloadExtraCaptions} onchange={options.setDownloadExtraCaptions} />
          </label>
        {/if}
      {/if}
    </div>
  {/if}

  <div class="options-group">
    <div class="options-output">
      <OptionField hint={output.filenameError} isHintError label="Filename">
        <input
          aria-invalid={!output.isFilenameValid}
          autocomplete="off"
          dir="auto"
          oninput={e => (panel.filename = getCompatibleFilename(e.currentTarget.value.trim()))}
          spellcheck={false}
          value={panel.filename}
        />
      </OptionField>
      <OptionSelect
        choices={output.formatOptions}
        label="Format"
        onchange={extension => {
          options.guardExtrasForExtension(extension);
          panel.extension = extension;
        }}
        value={panel.extension}
      />
    </div>
    {#if output.formatDescription}
      <p class="options-hint">{output.formatDescription}</p>
    {/if}
    {#if output.isConstraintHintShown}
      <p class="options-hint">Will be saved as .{panel.actualExtension} due to format constraints</p>
    {/if}
  </div>

  <div class="options-footer">
    <span class="options-size">{panel.estimatedSizeLabel}</span>
    <button
      class="options-download"
      disabled={!panel.isDownloadable || !output.isFilenameValid}
      onclick={panel.startDownload}
      type="button"
    >
      {@html downloadIcon}
      Download
    </button>
  </div>
</div>

<style>
  .options-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .options-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px 10px;
  }

  .options-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
  }

  .options-toggle {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: center;
    color: var(--fg);
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .options-output {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 96px;
    gap: 10px;
    align-items: start;
  }

  .options-hint,
  .options-error {
    margin: 0;
    font-size: 0.6875rem;
    line-height: 1.35;
  }

  .options-hint {
    color: var(--fg-subtle);
  }

  .options-error {
    color: var(--danger);
  }

  .options-footer {
    display: flex;
    gap: 12px;
    justify-content: space-between;
    align-items: center;
  }

  .options-size {
    color: var(--fg-muted);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
  }

  .options-download {
    display: inline-flex;
    gap: 6px;
    align-items: center;
    padding: 8px 16px;
    border: none;
    border-radius: 999px;
    background: var(--accent);
    color: var(--on-primary);
    font: inherit;
    font-weight: 600;
    font-size: 0.8125rem;
    cursor: pointer;
    transition: opacity 200ms;

    :global(svg) {
      width: 18px;
      height: 18px;
    }

    &:focus-visible {
      outline: 2px solid var(--fg);
      outline-offset: 2px;
    }

    &:disabled {
      opacity: 38%;
      cursor: not-allowed;
    }
  }
</style>
