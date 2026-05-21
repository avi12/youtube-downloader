<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import { DOWNLOAD_TYPES, handleQualityChange } from "./download-options-helpers";
  import { DownloadType } from "@/types";
  import type { AdaptiveFormatItem, LabeledOption } from "@/types";

  interface Props {
    downloadType: DownloadType;
    isDownloading: boolean;
    qualityOptions: LabeledOption[];
    qualityValue: string;
    audioFormats: AdaptiveFormatItem[];
    videoFormats: AdaptiveFormatItem[];
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
    audioFormats,
    videoFormats,
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
  <PolymerSelect
    id="quality-select"
    disabled={isDownloading}
    label="Quality"
    onchange={valueString => handleQualityChange({
      valueString,
      isAudio,
      audioFormats,
      videoFormats,
      onaudioformatchange,
      onvideoformatchange
    })}
    options={qualityOptions}
    value={qualityValue}
  />
</div>

<style>
  .ytdl-media-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  :global(.ytdl-section) {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
</style>
