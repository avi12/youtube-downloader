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
  <fieldset class="radio-group">
    <legend class="visually-hidden">Video quality</legend>
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
  </fieldset>
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

<style>
  .radio-group {
    display: flex;
    flex-direction: column;
    min-inline-size: auto;
    margin: 0;
    padding: 4px;
    border: none;
  }

  .visually-hidden {
    position: absolute;
    overflow: hidden;
    width: 1px;
    height: 1px;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .radio-item {
    display: flex;
    gap: 13px;
    align-items: flex-start;
    padding: 9px 10px;
    border-radius: 12px;
    cursor: pointer;

    &:hover {
      background: var(--surface-high);
    }
  }

  .radio-input-hidden {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0%;
  }

  .radio-dot {
    position: relative;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--fg-subtle);
    transition: box-shadow 150ms;

    &::after {
      content: "";
      position: absolute;
      inset: 0;
      width: 10px;
      height: 10px;
      margin: auto;
      border-radius: 50%;
      background: var(--accent);
      transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
      transform: scale(0);
    }
  }

  .radio-input-hidden:checked ~ .radio-dot {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .radio-input-hidden:checked ~ .radio-dot::after {
    transform: scale(1);
  }

  .radio-item:has(.radio-input-hidden:focus-visible) .radio-dot {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .radio-txt {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .radio-label {
    color: var(--fg);
    font-weight: 500;
    font-size: 0.84375rem;
  }

  .set-inset {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    background: var(--surface-high);
  }

  .set-inset-label {
    flex: 1;
    color: var(--fg-muted);
    font-size: 0.8125rem;
  }

  .set-select {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 0.8125rem;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }
</style>
