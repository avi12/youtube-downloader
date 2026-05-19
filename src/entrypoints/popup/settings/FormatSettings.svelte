<script lang="ts">
  import FormatSelect from "./FormatSelect.svelte";
  import type { SettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { supportedExtensions } from "@/lib/utils/containers";

  const { options }: SettingsProps = $props();
</script>

<SettingsGroup title="Format">
  <fieldset class="settings-format-section">
    <legend class="settings-sub-legend">Video container</legend>
    <FormatSelect
      onchange={extension => void setOption({
        key: "ext",
        value: {
          ...options.ext,
          video: extension
        }
      })}
      options={supportedExtensions.video}
      value={options.ext.video}
    />
  </fieldset>
  <fieldset class="settings-format-section">
    <legend class="settings-sub-legend">Audio container</legend>
    <FormatSelect
      onchange={extension => void setOption({
        key: "ext",
        value: {
          ...options.ext,
          audio: extension
        }
      })}
      options={supportedExtensions.audio}
      value={options.ext.audio}
    />
    <p class="settings-hint">Used for audio-only downloads</p>
  </fieldset>
</SettingsGroup>
