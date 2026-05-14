<script lang="ts">
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { VIDEO_QUALITIES } from "@/lib/youtube/video-helpers";
  import { VideoQualityMode } from "@/types";
  import type { Options } from "@/types";
  import { slide } from "svelte/transition";

  interface Props {
    options: Options;
    slideDuration: number;
  }

  const { options, slideDuration }: Props = $props();

  const qualityModeOptions = [
    {
      value: VideoQualityMode.CurrentQuality,
      label: "Match current player quality"
    },
    {
      value: VideoQualityMode.Best,
      label: "Best available quality"
    },
    {
      value: VideoQualityMode.Custom,
      label: "Custom quality"
    }
  ];
</script>

<SettingsGroup title="Video quality">
  {#each qualityModeOptions as { value, label } (value)}
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="quality-mode"
          checked={options.videoQualityMode === value}
          onchange={() => void setOption("videoQualityMode", value)}
          type="radio"
          {value}
        />
        {label}
      </label>
    </div>
    {#if value === VideoQualityMode.Custom && options.videoQualityMode === VideoQualityMode.Custom}
      <div class="settings-sub-row" transition:slide={{ duration: slideDuration }}>
        <label class="settings-label" for="custom-quality-select">Quality</label>
        <select
          id="custom-quality-select"
          class="settings-select"
          onchange={e => {
            if (e.target instanceof HTMLSelectElement) {
              void setOption("videoQuality", Number(e.target.value));
            }
          }}
          value={options.videoQuality}
        >
          {#each VIDEO_QUALITIES as quality (quality)}
            <option selected={quality === options.videoQuality} value={quality}>{quality}p</option>
          {/each}
        </select>
      </div>
    {/if}
  {/each}
</SettingsGroup>
