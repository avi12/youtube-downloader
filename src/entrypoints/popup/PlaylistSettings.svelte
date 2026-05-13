<script lang="ts">
  import { setOption } from "@/lib/storage/storage";
  import { PlaylistDownloadMode, PlaylistOutputMode } from "@/types";
  import type { Options } from "@/types";

  interface Props {
    options: Options;
  }

  const { options }: Props = $props();

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
</script>

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
