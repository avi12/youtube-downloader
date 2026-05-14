<script lang="ts">
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { DownloadType } from "@/types";
  import type { DownloadTypePreference, Options } from "@/types";

  interface Props {
    options: Options;
  }

  const { options }: Props = $props();

  const downloadTypeOptions: Array<{
    value: DownloadTypePreference;
    label: string;
  }> = [
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
  ];
</script>

<SettingsGroup title="Download type">
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
</SettingsGroup>
