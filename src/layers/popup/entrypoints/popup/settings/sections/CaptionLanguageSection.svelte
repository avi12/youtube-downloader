<script lang="ts">
  import type { SettingsProps } from "../settings-props";
  import SettingsRadioGroup from "../ui/SettingsRadioGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { CaptionLanguageMode } from "@/types";

  const { options }: SettingsProps = $props();

  const captionLanguageModeOptions = [
    {
      value: CaptionLanguageMode.SameAsAudio,
      label: "Same as audio",
      description: "Follows the audio language setting above"
    },
    {
      value: CaptionLanguageMode.OriginalLanguage,
      label: "Original language",
      description: "Prefers the video's native language captions"
    },
    {
      value: CaptionLanguageMode.MatchVideo,
      label: "Match selected track",
      description: "Uses the watch page audio track language, or YouTube's language elsewhere"
    },
    {
      value: CaptionLanguageMode.Custom,
      label: "Custom language",
      description: "Uses the same custom language set for audio above"
    }
  ] as const;
</script>

<SettingsRadioGroup
  name="caption-language-mode"
  legend="Closed captions language"
  onchange={value => {
    void setOption({
      key: "captionLanguageMode",
      value
    });
  }}
  options={captionLanguageModeOptions}
  selected={options.captionLanguageMode}
/>
