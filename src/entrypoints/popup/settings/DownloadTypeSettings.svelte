<script lang="ts">
  import type { SettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { DownloadType } from "@/types";

  const { options }: SettingsProps = $props();

  const downloadTypeOptions = [
    {
      value: DownloadType.Auto,
      label: "Auto (video for videos, audio for music)"
    },
    {
      value: DownloadType.VideoAndAudio,
      label: "Always video + audio"
    },
    {
      value: DownloadType.Video,
      label: "Always video only"
    },
    {
      value: DownloadType.Audio,
      label: "Always audio only"
    }
  ] as const;
</script>

<SettingsGroup title="Download type">
  <fieldset class="radio-group">
    <legend class="visually-hidden">Download type</legend>
    {#each downloadTypeOptions as { value, label } (value)}
      <label class="radio-item">
        <input
          name="download-type"
          class="radio-input-hidden"
          checked={options.defaultDownloadType === value}
          onchange={() => void setOption({
            key: "defaultDownloadType",
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
</style>
