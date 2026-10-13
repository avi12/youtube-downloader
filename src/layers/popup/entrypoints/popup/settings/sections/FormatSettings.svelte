<script lang="ts">
  import audioIcon from "../../icons/audio.svg?raw";
  import videoIcon from "../../icons/video.svg?raw";
  import type { SlidingSettingsProps } from "../settings-props";
  import SettingsDropDown from "../ui/SettingsDropDown.svelte";
  import SettingsGroup from "../ui/SettingsGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import {
    audioContainers,
    AUTO_AUDIO_EXTENSION_DESCRIPTION,
    AUTO_EXTENSION,
    AUTO_EXTENSION_LABEL,
    AUTO_VIDEO_EXTENSION_DESCRIPTION,
    buildFormatGroups,
    describeAudioCodecPreference,
    describeVideoCodecPreference,
    videoContainers
  } from "@/lib/utils/containers";
  import { AudioCodecPreference, VideoCodecPreference } from "@/types";

  const { options, slideDuration }: SlidingSettingsProps = $props();

  function shortLabel(extension: string): string {
    return extension === AUTO_EXTENSION ? AUTO_EXTENSION_LABEL : extension.toUpperCase();
  }

  const videoItems = $derived([
    {
      value: AUTO_EXTENSION,
      label: AUTO_EXTENSION_LABEL,
      description: AUTO_VIDEO_EXTENSION_DESCRIPTION
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
      description: AUTO_AUDIO_EXTENSION_DESCRIPTION
    },
    ...buildFormatGroups({ allowedExtensions: audioContainers })
      .flatMap(group => group.items)
      .map(item => ({
        value: item.extension,
        label: shortLabel(item.extension),
        description: item.description || undefined
      }))
  ]);

  const CODEC_SUBTITLE = "Used when the container supports it";

  const videoCodecItems = Object.values(VideoCodecPreference).map(preference => ({
    value: preference,
    ...describeVideoCodecPreference(preference)
  }));

  const audioCodecItems = Object.values(AudioCodecPreference).map(preference => ({
    value: preference,
    ...describeAudioCodecPreference(preference)
  }));

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
    currentValue={options.videoCodec}
    displayValue={describeVideoCodecPreference(options.videoCodec).label}
    items={videoCodecItems}
    label="Video codec"
    onSelect={selected => {
      const preference = videoCodecItems.find(item => item.value === selected)?.value;
      if (preference) {
        void setOption({
          key: "videoCodec",
          value: preference
        });
      }
    }}
    {slideDuration}
    subtitle={CODEC_SUBTITLE}
  >
    {#snippet icon()}
      {@html videoIcon}
    {/snippet}
  </SettingsDropDown>

  <SettingsDropDown
    currentValue={options.audioCodec}
    displayValue={describeAudioCodecPreference(options.audioCodec).label}
    items={audioCodecItems}
    label="Audio codec"
    onSelect={selected => {
      const preference = audioCodecItems.find(item => item.value === selected)?.value;
      if (preference) {
        void setOption({
          key: "audioCodec",
          value: preference
        });
      }
    }}
    {slideDuration}
    subtitle={CODEC_SUBTITLE}
  >
    {#snippet icon()}
      {@html audioIcon}
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
