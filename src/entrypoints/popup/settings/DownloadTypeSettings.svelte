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
