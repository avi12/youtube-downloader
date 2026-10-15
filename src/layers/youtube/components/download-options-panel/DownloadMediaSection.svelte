<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import ChoiceSelect from "./ChoiceSelect.svelte";
  import {
    DOWNLOAD_TYPES,
    findAudioFormatByValue,
    handleQualityChange
  } from "@/lib/download-options/download-options-helpers";
  import type { Choice } from "@/lib/utils/choices";
  import { DownloadType } from "@/types";
  import type { AdaptiveFormatItem } from "@/types";

  interface Props {
    downloadType: DownloadType;
    isDownloading: boolean;
    qualityOptions: Choice[];
    qualityValue: string;
    videoCodecOptions: Choice[];
    videoCodecValue: string;
    audioCodecOptions: Choice[];
    audioCodecValue: string;
    audioFormats: AdaptiveFormatItem[];
    videoFormatVariants: AdaptiveFormatItem[];
    isAudio: boolean;
    ondownloadtypechange: (type: DownloadType) => void;
    onvideoformatchange: (format: AdaptiveFormatItem) => void;
    onaudioformatchange: (format: AdaptiveFormatItem) => void;
  }

  const {
    downloadType,
    isDownloading,
    qualityOptions,
    qualityValue,
    videoCodecOptions,
    videoCodecValue,
    audioCodecOptions,
    audioCodecValue,
    audioFormats,
    videoFormatVariants,
    isAudio,
    ondownloadtypechange,
    onvideoformatchange,
    onaudioformatchange
  }: Props = $props();
</script>

<div class="ytdl-media-grid">
  <PolymerSelect
    id="type-select"
    disabled={isDownloading}
    label="Type"
    onchange={newValue => {
      const type = DOWNLOAD_TYPES.find(item => item.value === newValue);
      if (type) {
        ondownloadtypechange(type.value);
      }
    }}
    options={DOWNLOAD_TYPES}
    value={downloadType}
  />
  <ChoiceSelect
    id="quality-select"
    choices={qualityOptions}
    disabled={isDownloading}
    label="Quality"
    onchange={valueString => handleQualityChange({
      valueString,
      isAudio,
      audioFormats,
      videoFormatVariants,
      onaudioformatchange,
      onvideoformatchange
    })}
    value={qualityValue}
  />
  {#if videoCodecOptions.length > 0}
    <ChoiceSelect
      id="video-codec-select"
      choices={videoCodecOptions}
      disabled={isDownloading}
      label="Video codec"
      onchange={valueString => handleQualityChange({
        valueString,
        isAudio: false,
        audioFormats,
        videoFormatVariants,
        onaudioformatchange,
        onvideoformatchange
      })}
      value={videoCodecValue}
    />
  {/if}
  {#if audioCodecOptions.length > 0}
    <ChoiceSelect
      id="audio-codec-select"
      choices={audioCodecOptions}
      disabled={isDownloading}
      label="Audio quality"
      onchange={valueString => {
        const format = findAudioFormatByValue({
          audioFormats,
          valueString
        });
        if (format) {
          onaudioformatchange(format);
        }
      }}
      value={audioCodecValue}
    />
  {/if}
</div>

<style>
  .ytdl-media-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 10px;
  }

  :global(.ytdl-section) {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
