<script lang="ts">
  import type { SlidingSettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { VIDEO_QUALITIES } from "@/lib/youtube/video-helpers";
  import { VideoQualityMode } from "@/types";
  import { slide } from "svelte/transition";

  const { options, slideDuration }: SlidingSettingsProps = $props();

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
  ] as const;
</script>

<SettingsGroup title="Video quality">
  {#each qualityModeOptions as { value, label } (value)}
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="quality-mode"
          checked={options.videoQualityMode === value}
          onchange={() => void setOption({
            key: "videoQualityMode",
            value
          })}
          type="radio"
          {value}
        />
        {label}
      </label>
    </div>
    {@const isCustomMode = value === VideoQualityMode.Custom}
    {@const isCustomQualityActive = isCustomMode && options.videoQualityMode === VideoQualityMode.Custom}
    {#if isCustomQualityActive}
      <div class="settings-sub-row" transition:slide={{ duration: slideDuration }}>
        <label class="settings-label" for="custom-quality-select">Quality</label>
        <select
          id="custom-quality-select"
          class="settings-select"
          onchange={e => {
            if (!(e.target instanceof HTMLSelectElement)) {
              return;
            }

            void setOption({
              key: "videoQuality",
              value: Number(e.target.value)
            });
          }}
        >
          {#each VIDEO_QUALITIES as quality (quality)}
            <option selected={quality === options.videoQuality} value={quality}>{quality}p</option>
          {/each}
        </select>
      </div>
    {/if}
  {/each}
</SettingsGroup>
