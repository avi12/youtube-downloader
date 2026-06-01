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
  <div class="radio-group" aria-label="Video quality" role="radiogroup">
    {#each qualityModeOptions as { value, label } (value)}
      <label class="radio-item">
        <input
          name="quality-mode"
          class="radio-input-hidden"
          checked={options.videoQualityMode === value}
          onchange={() => void setOption({
            key: "videoQualityMode",
            value
          })}
          type="radio"
          {value}
        />
        <div class="radio-dot"></div>
        <div class="radio-txt">
          <span class="radio-label">{label}</span>
        </div>
      </label>
    {/each}
  </div>
  {#if options.videoQualityMode === VideoQualityMode.Custom}
    <div class="set-inset" transition:slide={{ duration: slideDuration }}>
      <label class="set-inset-label" for="custom-quality-select">Quality</label>
      <select
        id="custom-quality-select"
        class="set-select"
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
</SettingsGroup>
