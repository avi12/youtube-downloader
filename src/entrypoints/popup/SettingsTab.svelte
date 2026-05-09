<script lang="ts">
  import FormatSelect from "./FormatSelect.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { supportedExtensions } from "@/lib/utils/containers";
  import { videoQualities } from "@/lib/youtube/video-helpers";
  import {
    AudioTrackLanguageMode,
    DownloadType,
    PlaylistDownloadMode,
    PlaylistOutputMode,
    VideoQualityMode
  } from "@/types";
  import type { DownloadTypePreference, Options } from "@/types";
  import { slide } from "svelte/transition";

  type Props = {
    options: Options;
  };

  const { options }: Props = $props();

  const downloadTypeOptions: Array<{
    value: DownloadTypePreference;
    label: string;
  }> = [
    {
      value: "auto",
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
  ];

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

  const playlistDownloadModeOptions = [
    {
      value: PlaylistDownloadMode.Fast,
      label: "In parallel"
    },
    {
      value: PlaylistDownloadMode.DataSaver,
      label: "One at a time"
    }
  ];

  const playlistOutputModeOptions: Array<{
    value: PlaylistOutputMode;
    label: string;
  }> = [
    {
      value: PlaylistOutputMode.Individual,
      label: "Separate files"
    },
    {
      value: PlaylistOutputMode.Zip,
      label: "Single ZIP"
    }
  ];

  const languageModeOptions: Array<{
    value: AudioTrackLanguageMode;
    label: string;
  }> = [
    {
      value: AudioTrackLanguageMode.MatchYouTube,
      label: "Match YouTube language"
    },
    {
      value: AudioTrackLanguageMode.OriginalLanguage,
      label: "Original language"
    }
  ];
</script>

<div class="settings-container">
  <fieldset class="settings-group">
    <legend class="settings-legend">Format</legend>
    <div class="settings-format-section">
      <span class="settings-sub-legend">Video container</span>
      <FormatSelect
        onchange={extension => void setOption("ext", {
          ...options.ext,
          video: extension
        })}
        options={supportedExtensions.video}
        value={options.ext.video}
      />
    </div>
    <div class="settings-format-section">
      <span class="settings-sub-legend">Audio container</span>
      <FormatSelect
        onchange={extension => void setOption("ext", {
          ...options.ext,
          audio: extension
        })}
        options={supportedExtensions.audio}
        value={options.ext.audio}
      />
      <p class="settings-hint">Used for audio-only downloads</p>
    </div>
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
      </div>
      {#if value === VideoQualityMode.Custom && options.videoQualityMode === VideoQualityMode.Custom}
        <div class="settings-sub-row" transition:slide={{ duration: 200 }}>
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
    {/each}
  </fieldset>

  <fieldset class="settings-group">
    <legend class="settings-legend">Playlist</legend>
    <div class="settings-format-section">
      <span class="settings-sub-legend">Download speed</span>
      {#each playlistDownloadModeOptions as { value, label } (value)}
        <div class="settings-row">
          <label class="settings-label settings-radio-label">
            <input
              name="playlist-download-mode"
              checked={options.playlistDownloadMode === value}
              onchange={() => void setOption("playlistDownloadMode", value)}
              type="radio"
              {value}
            />
            {label}
          </label>
        </div>
      {/each}
    </div>
    <div class="settings-format-section">
      <span class="settings-sub-legend">Output - video playlists</span>
      {#each playlistOutputModeOptions as { value, label } (value)}
        <div class="settings-row">
          <label class="settings-label settings-radio-label">
            <input
              name="playlist-output-mode"
              checked={options.playlistOutputMode === value}
              onchange={() => void setOption("playlistOutputMode", value)}
              type="radio"
              {value}
            />
            {label}
          </label>
        </div>
      {/each}
    </div>
    <div class="settings-format-section">
      <span class="settings-sub-legend">Output - audio playlists</span>
      {#each playlistOutputModeOptions as { value, label } (value)}
        <div class="settings-row">
          <label class="settings-label settings-radio-label">
            <input
              name="playlist-audio-output-mode"
              checked={options.playlistAudioOutputMode === value}
              onchange={() => void setOption("playlistAudioOutputMode", value)}
              type="radio"
              {value}
            />
            {label}
          </label>
        </div>
      {/each}
    </div>
    <div class="settings-format-section">
      <div class="settings-row">
        <span class="settings-label">Scroll to each video while downloading</span>
        <label class="settings-switch" aria-label="Scroll to each video while downloading">
          <input
            checked={options.isPlaylistScrollSyncEnabled}
            onchange={e => {
              if (e.target instanceof HTMLInputElement) {
                void setOption("isPlaylistScrollSyncEnabled", e.target.checked);
              }
            }}
            role="switch"
            type="checkbox"
          />
          <span class="settings-switch-track">
            <span class="settings-switch-thumb"></span>
          </span>
        </label>
      </div>
    </div>
  </fieldset>

  <fieldset class="settings-group">
    <legend class="settings-legend">Audio &amp; subtitles</legend>
    <span class="settings-sub-legend">Language priority for audio tracks and subtitles</span>
    <p class="settings-hint">Applies to videos with multiple languages when no track is actively selected</p>
    {#each languageModeOptions as { value, label } (value)}
      <div class="settings-row">
        <label class="settings-label settings-radio-label">
          <input
            name="language-mode"
            checked={options.audioTrackLanguageMode === value}
            onchange={() => void setOption("audioTrackLanguageMode", value)}
            type="radio"
            {value}
          />
          {label}
        </label>
      </div>
    {/each}
  </fieldset>

  <fieldset class="settings-group">
    <legend class="settings-legend">YouTube integration</legend>
    <div class="settings-row">
      <span class="settings-label">Show native download button on watch page</span>
      <label class="settings-switch" aria-label="Show native download button on watch page">
        <input
          checked={options.isShowNativeDownload}
          onchange={e => {
            if (e.target instanceof HTMLInputElement) {
              void setOption("isShowNativeDownload", e.target.checked);
            }
          }}
          role="switch"
          type="checkbox"
        />
        <span class="settings-switch-track">
          <span class="settings-switch-thumb"></span>
        </span>
      </label>
    </div>
  </fieldset>
</div>

<style>
  .settings-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .settings-group {
    display: grid;
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
    font-size: 0.875rem;
    letter-spacing: 0.02em;
  }

  .settings-format-section {
    display: grid;

    & + & {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
  }

  .settings-sub-legend {
    margin-bottom: 4px;
    color: var(--fg-muted);
    font-weight: 500;
    font-size: 0.75rem;
  }

  .settings-row {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 0;
  }

  .settings-sub-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 4px;
    padding: 8px 12px;
    border-radius: 12px;
    background: var(--surface-high);
  }

  .settings-label {
    flex: 1;
    font-size: 0.8125rem;
  }

  .settings-radio-label {
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

  .settings-switch {
    position: relative;
    display: inline-flex;
    flex-shrink: 0;
    cursor: pointer;
  }

  .settings-switch input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0%;
  }

  .settings-switch-track {
    display: flex;
    align-items: center;
    width: 40px;
    height: 24px;
    border-radius: 12px;
    background: var(--border);
  }

  .settings-switch input:checked + .settings-switch-track {
    background: var(--accent);
  }

  .settings-switch input:focus-visible + .settings-switch-track {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .settings-switch-thumb {
    width: 14px;
    height: 14px;
    margin-left: 4px;
    border-radius: 50%;
    background: rgb(255 255 255);
    transition: transform 200ms;
  }

  .settings-switch input:checked + .settings-switch-track .settings-switch-thumb {
    transform: translateX(16px) scale(1.25);
  }
</style>
