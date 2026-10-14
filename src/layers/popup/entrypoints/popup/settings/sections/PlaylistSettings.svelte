<script lang="ts">
  import expandVerticalIcon from "../../icons/expand-vertical.svg?raw";
  import type { SettingsProps } from "../settings-props";
  import SettingsGroup from "../ui/SettingsGroup.svelte";
  import SettingsRadioGroup from "../ui/SettingsRadioGroup.svelte";
  import SettingsSwitchRow from "../ui/SettingsSwitchRow.svelte";
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
</script>

<SettingsGroup title="Playlist">
  <SettingsRadioGroup
    name="playlist-download-mode"
    legend="Download speed"
    onchange={value => {
      void setOption({
        key: "playlistDownloadMode",
        value
      });
    }}
    options={downloadModeOptions}
    selected={options.playlistDownloadMode}
  />
  <SettingsRadioGroup
    name="playlist-output-mode"
    legend="Output - video playlists"
    onchange={value => {
      void setOption({
        key: "playlistOutputMode",
        value
      });
    }}
    options={outputModeOptions}
    selected={options.playlistOutputMode}
  />
  <SettingsRadioGroup
    name="playlist-audio-output-mode"
    legend="Output - audio playlists"
    onchange={value => {
      void setOption({
        key: "playlistAudioOutputMode",
        value
      });
    }}
    options={outputModeOptions}
    selected={options.playlistAudioOutputMode}
  />
  <SettingsSwitchRow
    icon={expandVerticalIcon}
    isChecked={options.isPlaylistScrollSyncEnabled}
    label="Scroll to each video while downloading"
    onchange={isChecked => {
      void setOption({
        key: "isPlaylistScrollSyncEnabled",
        value: isChecked
      });
    }}
  />
</SettingsGroup>
