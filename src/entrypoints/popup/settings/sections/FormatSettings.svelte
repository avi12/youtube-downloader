<script lang="ts">
  import audioIcon from "../../icons/audio.svg?raw";
  import videoIcon from "../../icons/video.svg?raw";
  import type { SlidingSettingsProps } from "../settings-props";
  import SettingsDropDown from "../ui/SettingsDropDown.svelte";
  import SettingsGroup from "../ui/SettingsGroup.svelte";
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
      {@html videoIcon}
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
      {@html audioIcon}
    {/snippet}
  </SettingsDropDown>
</SettingsGroup>
