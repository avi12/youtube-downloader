<script lang="ts">
  import PlaylistRadioGroup from "./PlaylistRadioGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { PlaylistDownloadMode, PlaylistOutputMode } from "@/types";
  import type { Options } from "@/types";

  interface Props {
    options: Options;
  }

  const { options }: Props = $props();

  const downloadModeOptions: Array<{
    value: PlaylistDownloadMode;
    label: string;
  }> = [
    {
      value: PlaylistDownloadMode.Fast,
      label: "In parallel"
    },
    {
      value: PlaylistDownloadMode.DataSaver,
      label: "One at a time"
    }
  ];

  const outputModeOptions: Array<{
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

  function resolveDownloadMode(value: string) {
    return downloadModeOptions.find(opt => opt.value === value)?.value ?? PlaylistDownloadMode.Fast;
  }

  function resolveOutputMode(value: string) {
    return outputModeOptions.find(opt => opt.value === value)?.value ?? PlaylistOutputMode.Individual;
  }
</script>

<fieldset class="settings-group">
  <legend class="settings-legend">Playlist</legend>
  <PlaylistRadioGroup
    name="playlist-download-mode"
    legend="Download speed"
    onchange={value => void setOption("playlistDownloadMode", resolveDownloadMode(value))}
    options={downloadModeOptions}
    selected={options.playlistDownloadMode}
  />
  <PlaylistRadioGroup
    name="playlist-output-mode"
    legend="Output - video playlists"
    onchange={value => void setOption("playlistOutputMode", resolveOutputMode(value))}
    options={outputModeOptions}
    selected={options.playlistOutputMode}
  />
  <PlaylistRadioGroup
    name="playlist-audio-output-mode"
    legend="Output - audio playlists"
    onchange={value => void setOption("playlistAudioOutputMode", resolveOutputMode(value))}
    options={outputModeOptions}
    selected={options.playlistAudioOutputMode}
  />
  <div class="settings-format-section">
    <label class="settings-row">
      <span class="settings-label">Scroll to each video while downloading</span>
      <span class="settings-switch" aria-label="Scroll to each video while downloading">
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
      </span>
    </label>
  </div>
</fieldset>
