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

  const SCROLL_ICON_PATH = "M480-240 280-400l57-56 143 114 143-114 57 56-200 160Zm0-160L280-560l57-56 143 114"
    + " 143-114 57 56-200 160Zm0-160L280-720l200-160 200 160-200 160Z";
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
  <label class="set-item set-item-label">
    <div class="set-lead">
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 -960 960 960" width="20">
        <path d={SCROLL_ICON_PATH} />
      </svg>
    </div>
    <div class="set-txt">
      <span class="set-label">Scroll to each video while downloading</span>
    </div>
    <div class="set-trail">
      <span class="set-switch">
        <input
          class="set-switch-input"
          checked={options.isPlaylistScrollSyncEnabled}
          onchange={e => {
            if (!(e.target instanceof HTMLInputElement)) {
              return;
            }

            void setOption({
              key: "isPlaylistScrollSyncEnabled",
              value: e.target.checked
            });
          }}
          role="switch"
          type="checkbox"
        />
        <span class="set-switch-track"></span>
      </span>
    </div>
  </label>
</SettingsGroup>
