<script lang="ts">
  import FormatSelect from "./FormatSelect.svelte";
  import { supportedExtensions } from "@/lib/containers";
  import { setOption } from "@/lib/storage";
  import { videoQualities } from "@/lib/video-helpers";
  import { DownloadType, VideoQualityMode } from "@/types";
  import type { DownloadTypePreference, Options } from "@/types";

  type Props = {
    options: Options;
  };

  const { options }: Props = $props();

  const downloadTypeOptions: Array<{
    value: DownloadTypePreference;
    label: string;
  }> = [
    { value: "auto", label: "Auto (video for videos, audio for music)" },
    { value: DownloadType.VideoAndAudio, label: "Always video + audio" },
    { value: DownloadType.Video, label: "Always video only" },
    { value: DownloadType.Audio, label: "Always audio only" }
  ];

  const qualityModeOptions: Array<{
    value: Options["videoQualityMode"];
    label: string;
  }> = [
    { value: VideoQualityMode.CurrentQuality, label: "Match current player quality" },
    { value: VideoQualityMode.Best, label: "Best available quality" },
    { value: VideoQualityMode.Custom, label: "Custom quality" }
  ];
</script>

<div class="settings-container">
  <fieldset class="settings-group">
    <legend class="settings-legend">Video format</legend>
    <FormatSelect
      id="video-ext"
      label="Container"
      onchange={extension => void setOption("ext", { ...options.ext, video: extension })}
      options={supportedExtensions.video}
      value={options.ext.video}
    />
  </fieldset>

  <fieldset class="settings-group">
    <legend class="settings-legend">Audio format</legend>
    <FormatSelect
      id="audio-ext"
      label="Container"
      onchange={extension => void setOption("ext", { ...options.ext, audio: extension })}
      options={supportedExtensions.audio}
      value={options.ext.audio}
    />
    <p class="settings-hint">Used for audio-only downloads</p>
  </fieldset>

  <fieldset class="settings-group">
    <legend class="settings-legend">Download type</legend>
    {#each downloadTypeOptions as { value, label } (value)}
      <div class="settings-row">
        <label class="settings-label settings-radio-label">
          <input
            name="download-type"
            checked={options.defaultDownloadType === value}
            onchange={() => void setOption("defaultDownloadType", value)}
            type="radio"
            {value}
          />
          {label}
        </label>
      </div>
    {/each}
  </fieldset>

  <fieldset class="settings-group">
    <legend class="settings-legend">Video quality</legend>
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
        {#if value === VideoQualityMode.Custom && options.videoQualityMode === VideoQualityMode.Custom}
          <div class="settings-sub-row">
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
              {#each videoQualities as quality (quality)}
                <option
                  selected={quality === options.videoQuality}
                  value={quality}
                  >{quality}p</option
                >
              {/each}
            </select>
          </div>
        {/if}
      </div>
    {/each}
  </fieldset>

  <fieldset class="settings-group">
    <legend class="settings-legend">YouTube integration</legend>
    <div class="settings-row">
      <label class="settings-label settings-toggle-label">
        <input
          checked={options.isRemoveNativeDownload}
          onchange={e => {
            if (e.target instanceof HTMLInputElement) {
              void setOption("isRemoveNativeDownload", e.target.checked);
            }
          }}
          type="checkbox"
        />
        Hide YouTube's native download button
      </label>
    </div>
  </fieldset>
</div>

<style>
  .settings-container {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .settings-group {
    padding: 16px;
    border: none;
    border-radius: 16px;
    background: var(--surface);
  }

  .settings-legend {
    margin-bottom: 8px;
    padding: 0;
    color: var(--accent);
    font-weight: 500;
    font-size: 0.75rem;
    letter-spacing: 0.02em;
  }

  .settings-row {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 6px 0;

    & + & {
      margin-top: 2px;
    }
  }

  .settings-sub-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 10px;
    padding-left: 26px;
  }

  .settings-label {
    flex: 1;
    font-size: 0.8125rem;
  }

  .settings-radio-label,
  .settings-toggle-label {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 0.8125rem;
    cursor: pointer;
  }

  .settings-select {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg, transparent);
    color: inherit;
    font-family: inherit;
    font-size: 0.8125rem;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  [type="radio"],
  [type="checkbox"] {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-top: 1px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .settings-hint {
    margin-top: 8px;
    color: var(--fg-subtle);
    font-size: 0.6875rem;
  }
</style>
