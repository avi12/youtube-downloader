<script lang="ts">
  import FormatSelect from "../../components/FormatSelect.svelte";
  import { setOption } from "../../lib/storage";
  import { supportedExtensions, videoQualities } from "../../lib/utils";
  import type { DownloadTypePreference, Options } from "../../types";

  type Props = {
    options: Options;
  };

  const { options }: Props = $props();

  function updateAudioExtension(extension: string) {
    void setOption("ext", {
      ...options.ext,
      audio: extension
    });
  }

  function updateVideoExtension(extension: string) {
    void setOption("ext", {
      ...options.ext,
      video: extension
    });
  }

  function updateDefaultDownloadType(type: DownloadTypePreference) {
    void setOption("defaultDownloadType", type);
  }

  function updateVideoQualityMode(mode: Options["videoQualityMode"]) {
    void setOption("videoQualityMode", mode);
  }

  function handleVideoQualityChange(e: Event) {
    const { target } = e;
    if (target instanceof HTMLSelectElement) {
      void setOption("videoQuality", Number(target.value));
    }
  }

  function handleRemoveNativeDownloadChange(e: Event) {
    const { target } = e;
    if (target instanceof HTMLInputElement) {
      void setOption("isRemoveNativeDownload", target.checked);
    }
  }
</script>

<div class="settings-container">
  <!-- Video format -->
  <fieldset class="settings-group">
    <legend class="settings-legend">Video format</legend>
    <FormatSelect
      id="video-ext"
      label="Container"
      onchange={updateVideoExtension}
      options={supportedExtensions.video}
      value={options.ext.video}
    />
  </fieldset>

  <!-- Audio format -->
  <fieldset class="settings-group">
    <legend class="settings-legend">Audio format</legend>
    <FormatSelect
      id="audio-ext"
      label="Container"
      onchange={updateAudioExtension}
      options={supportedExtensions.audio}
      value={options.ext.audio}
    />
    <p class="settings-hint">Used for audio-only downloads</p>
  </fieldset>

  <!-- Default download type -->
  <fieldset class="settings-group">
    <legend class="settings-legend">Download type</legend>
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="download-type"
          checked={options.defaultDownloadType === "auto"}
          onchange={() => updateDefaultDownloadType("auto")}
          type="radio"
          value="auto"
        />
        Auto (video for videos, audio for music)
      </label>
    </div>
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="download-type"
          checked={options.defaultDownloadType === "video+audio"}
          onchange={() => updateDefaultDownloadType("video+audio")}
          type="radio"
          value="video+audio"
        />
        Always video + audio
      </label>
    </div>
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="download-type"
          checked={options.defaultDownloadType === "video"}
          onchange={() => updateDefaultDownloadType("video")}
          type="radio"
          value="video"
        />
        Always video only
      </label>
    </div>
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="download-type"
          checked={options.defaultDownloadType === "audio"}
          onchange={() => updateDefaultDownloadType("audio")}
          type="radio"
          value="audio"
        />
        Always audio only
      </label>
    </div>
  </fieldset>

  <!-- Video quality -->
  <fieldset class="settings-group">
    <legend class="settings-legend">Video quality</legend>
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="quality-mode"
          checked={options.videoQualityMode === "current-quality"}
          onchange={() => updateVideoQualityMode("current-quality")}
          type="radio"
          value="current-quality"
        />
        Match current player quality
      </label>
    </div>
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="quality-mode"
          checked={options.videoQualityMode === "best"}
          onchange={() => updateVideoQualityMode("best")}
          type="radio"
          value="best"
        />
        Best available quality
      </label>
    </div>
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="quality-mode"
          checked={options.videoQualityMode === "custom"}
          onchange={() => updateVideoQualityMode("custom")}
          type="radio"
          value="custom"
        />
        Custom quality
      </label>
      {#if options.videoQualityMode === "custom"}
        <div class="settings-sub-row">
          <label class="settings-label" for="custom-quality-select">
            Quality
          </label>
          <select
            id="custom-quality-select"
            class="settings-select"
            onchange={handleVideoQualityChange}
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
  </fieldset>

  <!-- Remove native download button -->
  <fieldset class="settings-group">
    <legend class="settings-legend">YouTube integration</legend>
    <div class="settings-row">
      <label class="settings-label settings-toggle-label">
        <input
          checked={options.isRemoveNativeDownload}
          onchange={handleRemoveNativeDownloadChange}
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
    padding: 0;
    margin-bottom: 8px;
    color: var(--accent);
    font-weight: 500;
    font-size: 1.2rem;
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
    font-size: 1.3rem;
  }

  .settings-radio-label,
  .settings-toggle-label {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 1.3rem;
    cursor: pointer;
  }

  .settings-select {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--bg, transparent);
    color: inherit;
    font-family: inherit;
    font-size: 1.3rem;
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
    font-size: 1.1rem;
  }
</style>
