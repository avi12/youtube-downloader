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
  <div class="radio-group" aria-label="Download type" role="radiogroup">
    {#each downloadTypeOptions as { value, label } (value)}
      <label class="radio-item">
        <input
          name="download-type"
          class="radio-input-hidden"
          checked={options.defaultDownloadType === value}
          onchange={() => void setOption({
            key: "defaultDownloadType",
            value
          })}
          type="radio"
          {value}
        />
        <div class="radio-dot"></div>
        <div class="radio-txt">
          <span class="radio-label">{label}</span>
        </div>
      </label>
    {/each}
  </div>
</SettingsGroup>
