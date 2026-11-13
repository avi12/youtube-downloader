<script lang="ts">
  import audioVolumeIcon from "@/layers/popup/entrypoints/popup/icons/audio-volume.svg?raw";
  import captionsIcon from "@/layers/popup/entrypoints/popup/icons/captions.svg?raw";
  import sparkleIcon from "@/layers/popup/entrypoints/popup/icons/sparkle.svg?raw";
  import type { SlidingSettingsProps } from "@/layers/popup/entrypoints/popup/settings/settings-props";
  import SettingsGroup from "@/layers/popup/entrypoints/popup/settings/ui/SettingsGroup.svelte";
  import SettingsSwitchRow from "@/layers/popup/entrypoints/popup/settings/ui/SettingsSwitchRow.svelte";
  import AudioTrackSection from "./AudioTrackSection.svelte";
  import CaptionLanguageSection from "./CaptionLanguageSection.svelte";
  import { setOption } from "@/lib/storage/storage";

  const { options, slideDuration }: SlidingSettingsProps = $props();
</script>

<SettingsGroup title="Audio &amp; subtitles">
  <SettingsSwitchRow
    icon={captionsIcon}
    isAccent
    isChecked={options.downloadExtras}
    label="Download additional audio tracks and captions"
    onchange={isChecked => {
      void setOption({
        key: "downloadExtras",
        value: isChecked
      });
    }}
  />
  <SettingsSwitchRow
    icon={audioVolumeIcon}
    isChecked={options.includeAutoDubbing}
    label="Include auto-dubbed audio tracks"
    onchange={isChecked => {
      void setOption({
        key: "includeAutoDubbing",
        value: isChecked
      });
    }}
  />
  <SettingsSwitchRow
    icon={sparkleIcon}
    isChecked={options.includeAiCaptions}
    label="Include AI-generated captions"
    onchange={isChecked => {
      void setOption({
        key: "includeAiCaptions",
        value: isChecked
      });
    }}
  />
  <AudioTrackSection {options} {slideDuration} />
  <CaptionLanguageSection {options} />
</SettingsGroup>
