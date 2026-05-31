<script lang="ts">
  import FormatSelect from "./FormatSelect.svelte";
  import type { SlidingSettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { audioContainers, AUTO_EXTENSION, buildFormatGroups, videoContainers } from "@/lib/utils/containers";

  const { options }: SlidingSettingsProps = $props();

  const videoFormatItems = $derived([
    {
      extension: AUTO_EXTENSION,
      description: "",
      group: "Video" as const,
      isExcluded: false
    },
    ...buildFormatGroups({ allowedExtensions: videoContainers }).flatMap(group => group.items)
  ]);
  const audioFormatItems = $derived([
    {
      extension: AUTO_EXTENSION,
      description: "",
      group: "Audio" as const,
      isExcluded: false
    },
    ...buildFormatGroups({ allowedExtensions: audioContainers }).flatMap(group => group.items)
  ]);
</script>

<SettingsGroup title="Format">
  <fieldset class="settings-format-section">
    <legend class="settings-sub-legend">Video container</legend>
    <FormatSelect
      items={videoFormatItems}
      onchange={extension => void setOption({
        key: "ext",
        value: {
          ...options.ext,
          video: extension
        }
      })}
      value={options.ext.video}
    />
  </fieldset>
  <fieldset class="settings-format-section">
    <legend class="settings-sub-legend">Audio container</legend>
    <FormatSelect
      items={audioFormatItems}
      onchange={extension => void setOption({
        key: "ext",
        value: {
          ...options.ext,
          audio: extension
        }
      })}
      value={options.ext.audio}
    />
    <p class="settings-hint">Used for audio-only downloads</p>
  </fieldset>
</SettingsGroup>
