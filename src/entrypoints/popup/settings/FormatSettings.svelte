<script lang="ts">
  import type { SlidingSettingsProps } from "./settings-types";
  import SettingsDropDown from "./SettingsDropDown.svelte";
  import SettingsGroup from "./SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import {
    audioContainers,
    AUTO_EXTENSION,
    AUTO_EXTENSION_LABEL,
    buildFormatGroups,
    videoContainers
  } from "@/lib/utils/containers";

  const { options, slideDuration }: SlidingSettingsProps = $props();

  function shortLabel(extension: string): string {
    return extension === AUTO_EXTENSION ? AUTO_EXTENSION_LABEL : extension.toUpperCase();
  }

  const videoItems = $derived([
    {
      value: AUTO_EXTENSION,
      label: AUTO_EXTENSION_LABEL,
      description: undefined
    },
    ...buildFormatGroups({ allowedExtensions: videoContainers })
      .flatMap(group => group.items)
      .map(item => ({
        value: item.extension,
        label: shortLabel(item.extension),
        description: item.description || undefined
      }))
  ]);

  const audioItems = $derived([
    {
      value: AUTO_EXTENSION,
      label: AUTO_EXTENSION_LABEL,
      description: undefined
    },
    ...buildFormatGroups({ allowedExtensions: audioContainers })
      .flatMap(group => group.items)
      .map(item => ({
        value: item.extension,
        label: shortLabel(item.extension),
        description: item.description || undefined
      }))
  ]);

  function selectVideo(extension: string): void {
    void setOption({
      key: "ext",
      value: {
        ...options.ext,
        video: extension
      }
    });
  }

  function selectAudio(extension: string): void {
    void setOption({
      key: "ext",
      value: {
        ...options.ext,
        audio: extension
      }
    });
  }

  const VIDEO_ICON_PATH = "M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5"
    + "T880-720v480q0 33-23.5 56.5T800-160H160Zm0-80h640v-480H160v480Zm160-80 200-120-200-120v240Zm-160 80v-480 480Z";
  const AUDIO_ICON_PATH = "M400-120q-66 0-113-47t-47-113q0-66 47-113t113-47q23 0 42.5 5.5T480-418v-422h240v160H560"
    + "v400q0 66-47 113t-113 47Zm0-80q33 0 56.5-23.5T480-280q0-33-23.5-56.5T400-360q-33 0-56.5 23.5T320-280q0 33 23.5 56.5T400-200Z";
</script>

<SettingsGroup title="Format">
  <SettingsDropDown
    currentValue={options.ext.video}
    displayValue={shortLabel(options.ext.video)}
    items={videoItems}
    label="Video container"
    onSelect={selectVideo}
    {slideDuration}
  >
    {#snippet icon()}
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 -960 960 960" width="20">
        <path d={VIDEO_ICON_PATH} />
      </svg>
    {/snippet}
  </SettingsDropDown>

  <SettingsDropDown
    currentValue={options.ext.audio}
    displayValue={shortLabel(options.ext.audio)}
    items={audioItems}
    label="Audio container"
    onSelect={selectAudio}
    {slideDuration}
    subtitle="Used for audio-only downloads"
  >
    {#snippet icon()}
      <svg aria-hidden="true" fill="currentColor" height="20" viewBox="0 -960 960 960" width="20">
        <path d={AUDIO_ICON_PATH} />
      </svg>
    {/snippet}
  </SettingsDropDown>
</SettingsGroup>
