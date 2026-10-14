<script lang="ts">
  import type { SlidingSettingsProps } from "../settings-props";
  import SettingsDropDown from "../ui/SettingsDropDown.svelte";
  import SettingsRadioGroup from "../ui/SettingsRadioGroup.svelte";
  import { setOption } from "@/lib/storage/storage";
  import { AudioTrackLanguageMode } from "@/types";
  import { LANGUAGES } from "#popup/lib/languages";

  const { options, slideDuration }: SlidingSettingsProps = $props();

  const languageItems = LANGUAGES.map(([name, code]) => ({
    value: code,
    label: name
  }));
  const customLanguageName = $derived(
    LANGUAGES.find(([, code]) => code === options.customLanguage)?.[0] ?? options.customLanguage
  );

  const languageModeOptions = [
    {
      value: AudioTrackLanguageMode.OriginalLanguage,
      label: "Original language",
      description: "Uses the video's native/untagged audio track; falls back to video language then YouTube's language"
    },
    {
      value: AudioTrackLanguageMode.MatchVideo,
      label: "Match selected track",
      description: "Uses the video's current audio track on watch pages, or YouTube's language elsewhere"
    },
    {
      value: AudioTrackLanguageMode.Custom,
      label: "Custom language",
      description: "Falls back to English if the language is unavailable",
      sub: customLanguage
    }
  ] as const;
</script>

{#snippet customLanguage()}
  <SettingsDropDown
    currentValue={options.customLanguage}
    displayValue={customLanguageName}
    items={languageItems}
    label="Language"
    onSelect={selected => {
      void setOption({
        key: "customLanguage",
        value: selected
      });
    }}
    {slideDuration}
  />
{/snippet}

<SettingsRadioGroup
  name="language-mode"
  legend="Audio track language"
  onchange={value => {
    void setOption({
      key: "audioTrackLanguageMode",
      value
    });
  }}
  options={languageModeOptions}
  selected={options.audioTrackLanguageMode}
  {slideDuration}
/>
