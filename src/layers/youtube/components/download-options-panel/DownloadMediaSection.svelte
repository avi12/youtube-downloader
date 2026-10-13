<script lang="ts">
  import PolymerSelect from "../polymer-select/PolymerSelect.svelte";
  import ChoiceSelect from "./ChoiceSelect.svelte";
  import { DOWNLOAD_TYPES, findAudioFormatByValue, handleQualityChange } from "./download-options-helpers";
  import type { Choice } from "@/lib/utils/choices";
  import { DownloadType } from "@/types";
  import type { AdaptiveFormatItem, AudioCodecPreference, LabeledOption, VideoCodecPreference } from "@/types";

  interface Props {
    downloadType: DownloadType;
    isDownloading: boolean;
    qualityOptions: LabeledOption[];
    qualityValue: string;
    videoCodecChoices: Choice<VideoCodecPreference>[];
    videoCodecChoice: Choice<VideoCodecPreference> | undefined;
    audioCodecChoices: Choice<AudioCodecPreference>[];
    audioCodecChoice: Choice<AudioCodecPreference> | undefined;
    audioCodecOptions: LabeledOption[];
    audioCodecValue: string;
    audioFormats: AdaptiveFormatItem[];
    videoFormats: AdaptiveFormatItem[];
    isAudio: boolean;
    ondownloadtypechange: (type: DownloadType) => void;
    onvideoformatchange: (format: AdaptiveFormatItem) => void;
    onaudioformatchange: (format: AdaptiveFormatItem) => void;
    onvideocodecchange: (codec: VideoCodecPreference) => void;
    onaudiocodecchange: (codec: AudioCodecPreference) => void;
  }

  const {
    downloadType,
    isDownloading,
    qualityOptions,
    qualityValue,
    videoCodecChoices,
    videoCodecChoice,
    audioCodecChoices,
    audioCodecChoice,
    audioCodecOptions,
    audioCodecValue,
    audioFormats,
    videoFormats,
    isAudio,
    ondownloadtypechange,
    onvideoformatchange,
    onaudioformatchange,
    onvideocodecchange,
    onaudiocodecchange
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
  {#if videoCodecChoice}
    <ChoiceSelect
      id="video-codec-select"
      choice={videoCodecChoice}
      choices={videoCodecChoices}
      disabled={isDownloading}
      label="Video codec"
      onchange={onvideocodecchange}
    />
  {/if}
  {#if audioCodecChoice}
    <ChoiceSelect
      id="audio-codec-choice-select"
      choice={audioCodecChoice}
      choices={audioCodecChoices}
      disabled={isDownloading}
      label="Audio codec"
      onchange={onaudiocodecchange}
    />
  {/if}
  {#if audioCodecOptions.length > 0}
    <PolymerSelect
      id="audio-codec-select"
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
      options={audioCodecOptions}
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
