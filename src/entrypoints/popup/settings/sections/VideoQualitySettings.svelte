<script lang="ts">
  import sparkleIcon from "../../icons/sparkle.svg?raw";
  import type { SlidingSettingsProps } from "../settings-props";
  import SettingsDropDown from "../ui/SettingsDropDown.svelte";
  import SettingsGroup from "../ui/SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { VIDEO_QUALITIES } from "@/lib/youtube/video-helpers";
  import { VideoQualityMode } from "@/types";
  import { slide } from "svelte/transition";

  const { options, slideDuration }: SlidingSettingsProps = $props();

  const QUALITY_SUBLABELS: Record<number, string> = {
    4320: "8K",
    2160: "4K",
    1440: "2K",
    1080: "Full HD",
    720: "HD",
    480: "SD"
  };

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

  const customQualityItems = $derived(
    VIDEO_QUALITIES.map(quality => ({
      value: String(quality),
      label: `${quality}p`,
      description: QUALITY_SUBLABELS[quality]
    }))
  );
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
          onchange={() => {
            void setOption({
              key: "videoQualityMode",
              value
            });
          }}
          type="radio"
          {value}
        />
        <div class="radio-dot"></div>
        <div class="radio-txt">
          <span class="radio-label">{label}</span>
        </div>
      </label>
      {#if value === VideoQualityMode.Best && options.videoQualityMode === VideoQualityMode.Best}
        <div class="radio-sub" transition:slide={{ duration: slideDuration }}>
          <label class="enhanced-bitrate">
            <div class="enhanced-bitrate-txt">
              <span class="enhanced-bitrate-title">Enhanced bitrate</span>
              <span class="premium-badge">
                {@html sparkleIcon}
                YouTube Premium
              </span>
              <span class="enhanced-bitrate-desc">Grab the higher-bitrate stream whenever YouTube offers it</span>
            </div>
            <span class="set-switch">
              <input
                class="set-switch-input"
                checked={options.enhancedBitrate}
                onchange={e => {
                  if (!(e.target instanceof HTMLInputElement)) {
                    return;
                  }

                  void setOption({
                    key: "enhancedBitrate",
                    value: e.target.checked
                  });
                }}
                role="switch"
                type="checkbox"
              />
              <span class="set-switch-track"></span>
            </span>
          </label>
        </div>
      {/if}
      {#if value === VideoQualityMode.Custom && options.videoQualityMode === VideoQualityMode.Custom}
        <div class="radio-sub" transition:slide={{ duration: slideDuration }}>
          <SettingsDropDown
            currentValue={String(options.videoQuality)}
            displayValue={`${options.videoQuality}p`}
            items={customQualityItems}
            label="Quality"
            onSelect={selected => {
              void setOption({
                key: "videoQuality",
                value: Number(selected)
              });
            }}
            {slideDuration}
          />
        </div>
      {/if}
    {/each}
  </fieldset>
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
      transition: scale 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
      scale: 0;
    }

    .radio-input-hidden:checked ~ & {
      box-shadow: inset 0 0 0 2px var(--accent);

      &::after {
        scale: 1;
      }
    }

    .radio-item:has(.radio-input-hidden:focus-visible) & {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
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

  .radio-sub {
    margin-block: -2px 4px;
    margin-inline: 22px 8px;
    padding-inline-start: 21px;
    border-inline-start: 1.5px solid var(--border);
  }

  .enhanced-bitrate {
    display: flex;
    gap: 12px;
    align-items: center;
    padding-block: 8px;
    cursor: pointer;
  }

  .enhanced-bitrate-txt {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .enhanced-bitrate-title {
    color: var(--fg);
    font-weight: 600;
    font-size: 0.84375rem;
  }

  .enhanced-bitrate-desc {
    color: var(--fg-muted);
    font-size: 0.71875rem;
    line-height: 1.35;
  }

  .premium-badge {
    display: inline-flex;
    gap: 4px;
    align-items: center;
    align-self: flex-start;
    padding: 2px 8px;
    border: 1px solid color-mix(in oklab, var(--premium) 60%, transparent);
    border-radius: 999px;
    background: color-mix(in oklab, var(--premium) 12%, transparent);
    color: var(--premium);
    font-weight: 600;
    font-size: 0.6875rem;
    letter-spacing: 0.01em;

    :global(svg) {
      width: 12px;
      height: 12px;
    }
  }

  .set-switch {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
  }

  .set-switch-track {
    position: relative;
    display: block;
    width: 52px;
    height: 32px;
    border-radius: 16px;
    background-color: var(--surface-high);
    box-shadow: inset 0 0 0 2px var(--fg-subtle);
    cursor: pointer;
    transition: background-color 250ms, box-shadow 250ms;

    &::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 16px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: var(--fg-subtle);
      transition:
        translate 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
        scale 300ms cubic-bezier(0.34, 1.56, 0.64, 1),
        background-color 200ms;
      translate: -50% -50%;
    }
  }

  .set-switch-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0%;

    &:checked + .set-switch-track {
      background-color: var(--accent);
      box-shadow: inset 0 0 0 2px var(--accent);
    }

    &:checked + .set-switch-track::after {
      background-color: var(--on-primary);
      scale: 1.5;
      translate: calc(-50% + 22px) -50%;
    }

    &:focus-visible + .set-switch-track {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }
</style>
