<script lang="ts">
  import FormatSelect from "./FormatSelect.svelte";
  import type { SettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { supportedExtensions } from "@/lib/utils/containers";

  const { options }: SettingsProps = $props();
</script>

<SettingsGroup title="Format">
  <div class="settings-format-section">
    <span class="settings-sub-legend">Video container</span>
    <FormatSelect
      onchange={extension => void setOption("ext", {
        ...options.ext,
        video: extension
      })}
      options={supportedExtensions.video}
      value={options.ext.video}
    />
  </div>
  <div class="settings-format-section">
    <span class="settings-sub-legend">Audio container</span>
    <FormatSelect
      onchange={extension => void setOption("ext", {
        ...options.ext,
        audio: extension
      })}
      options={supportedExtensions.audio}
      value={options.ext.audio}
    />
    <p class="settings-hint">Used for audio-only downloads</p>
  </div>
</SettingsGroup>
