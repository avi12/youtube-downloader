<script lang="ts">
  import FormatSelect from "./FormatSelect.svelte";
  import type { SlidingSettingsProps } from "./settings-types";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { MULTI_TRACK_UNSUPPORTED_EXTENSIONS, supportedExtensions } from "@/lib/utils/containers";
  import { slide } from "svelte/transition";

  const { options, slideDuration }: SlidingSettingsProps = $props();

  const isMultiTrackUnsupported = $derived(MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(options.ext.video));
</script>

<SettingsGroup title="Format">
  <fieldset class="settings-format-section">
    <legend class="settings-sub-legend">Video container</legend>
    <FormatSelect
      onchange={async extension => {
        await setOption({
          key: "ext",
          value: {
            ...options.ext,
            video: extension
          }
        });

        if (!MULTI_TRACK_UNSUPPORTED_EXTENSIONS.has(extension)) {
          return;
        }

        await setOption({
          key: "downloadExtras",
          value: false
        });
        await setOption({
          key: "includeAutoDubbing",
          value: false
        });
      }}
      options={supportedExtensions.video}
      value={options.ext.video}
    />
    {#if isMultiTrackUnsupported}
      <p class="settings-warning" transition:slide={{ duration: slideDuration }}>
        AVI doesn't support multiple audio tracks - related settings have been turned off
      </p>
    {/if}
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
