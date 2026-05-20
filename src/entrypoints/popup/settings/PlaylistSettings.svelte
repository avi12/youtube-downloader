<script lang="ts">
  import PlaylistRadioGroup from "./PlaylistRadioGroup.svelte";
  import type { SettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { PlaylistDownloadMode, PlaylistOutputMode } from "@/types";

  const { options }: SettingsProps = $props();

  const downloadModeOptions = [
    {
      value: PlaylistDownloadMode.Fast,
      label: "In parallel"
    },
    {
      value: PlaylistDownloadMode.DataSaver,
      label: "One at a time"
    }
  ] as const;

  const outputModeOptions = [
    {
      value: PlaylistOutputMode.Individual,
      label: "Separate files"
    },
    {
      value: PlaylistOutputMode.Zip,
      label: "Single ZIP"
    }
  ] as const;

  function resolveDownloadMode(value: string): PlaylistDownloadMode {
    return downloadModeOptions.find(option => option.value === value)?.value ?? PlaylistDownloadMode.Fast;
  }

  function resolveOutputMode(value: string): PlaylistOutputMode {
    return outputModeOptions.find(option => option.value === value)?.value ?? PlaylistOutputMode.Individual;
  }

  function handleScrollSyncChange(e: Event): void {
    if (e.target instanceof HTMLInputElement) {
      void setOption({
        key: "isPlaylistScrollSyncEnabled",
        value: e.target.checked
      });
    }
  }
</script>

<SettingsGroup title="Playlist">
  <PlaylistRadioGroup
    name="playlist-download-mode"
    legend="Download speed"
    onchange={value => void setOption({
      key: "playlistDownloadMode",
      value: resolveDownloadMode(value)
    })}
    options={downloadModeOptions}
    selected={options.playlistDownloadMode}
  />
  <PlaylistRadioGroup
    name="playlist-output-mode"
    legend="Output - video playlists"
    onchange={value => void setOption({
      key: "playlistOutputMode",
      value: resolveOutputMode(value)
    })}
    options={outputModeOptions}
    selected={options.playlistOutputMode}
  />
  <PlaylistRadioGroup
    name="playlist-audio-output-mode"
    legend="Output - audio playlists"
    onchange={value => void setOption({
      key: "playlistAudioOutputMode",
      value: resolveOutputMode(value)
    })}
    options={outputModeOptions}
    selected={options.playlistAudioOutputMode}
  />
  <div class="settings-format-section">
    <label class="settings-row">
      <span class="settings-label">Scroll to each video while downloading</span>
      <span class="settings-switch" aria-label="Scroll to each video while downloading">
        <input
          checked={options.isPlaylistScrollSyncEnabled}
          onchange={handleScrollSyncChange}
          role="switch"
          type="checkbox"
        />
        <span class="settings-switch-track">
          <span class="settings-switch-thumb"></span>
        </span>
      </span>
    </label>
  </div>
</SettingsGroup>
