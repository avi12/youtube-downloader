<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import { DOWNLOAD_TYPES, handleQualityChange } from "./download-options-helpers";
  import { attachFormattedString } from "@/lib/ui/polymer-utils";
  import { DownloadType } from "@/types";
  import type { AdaptiveFormatItem } from "@/types";

  interface Props {
    downloadType: DownloadType;
    isDownloading: boolean;
    qualityOptions: {
      value: string;
      label: string;
    }[];
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

<div class="ytdl-section">
  <yt-formatted-string class="ytdl-section-label" {@attach attachFormattedString} data-ytdl-text="Media"></yt-formatted-string>
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

  :global(.ytdl-section-label) {
    display: block;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-weight: 700;
    font-size: 1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
</style>
