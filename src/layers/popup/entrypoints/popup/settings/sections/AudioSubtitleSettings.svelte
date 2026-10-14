<script lang="ts">
  import audioVolumeIcon from "../../icons/audio-volume.svg?raw";
  import captionsIcon from "../../icons/captions.svg?raw";
  import sparkleIcon from "../../icons/sparkle.svg?raw";
  import type { SlidingSettingsProps } from "../settings-props";
  import SettingsGroup from "../ui/SettingsGroup.svelte";
  import SettingsSwitchRow from "../ui/SettingsSwitchRow.svelte";
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
