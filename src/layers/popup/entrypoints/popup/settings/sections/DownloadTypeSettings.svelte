<script lang="ts">
  import type { SettingsProps } from "@/layers/popup/entrypoints/popup/settings/settings-props";
  import SettingsGroup from "@/layers/popup/entrypoints/popup/settings/ui/SettingsGroup.svelte";
  import SettingsRadioGroup from "@/layers/popup/entrypoints/popup/settings/ui/SettingsRadioGroup.svelte";
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
  <SettingsRadioGroup
    name="download-type"
    isLegendHidden
    legend="Download type"
    onchange={value => {
      void setOption({
        key: "defaultDownloadType",
        value
      });
    }}
    options={downloadTypeOptions}
    selected={options.defaultDownloadType}
  />
</SettingsGroup>
