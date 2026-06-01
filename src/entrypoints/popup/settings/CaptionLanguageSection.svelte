<script lang="ts">
  import type { SettingsProps } from "./settings-types";
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

<fieldset class="set-section-fieldset">
  <legend class="radio-group-legend">Closed captions language</legend>
  <div class="radio-group" role="radiogroup">
    {#each captionLanguageModeOptions as { value, label, description } (value)}
      <label class="radio-item">
        <input
          name="caption-language-mode"
          class="radio-input-hidden"
          checked={options.captionLanguageMode === value}
          onchange={() => void setOption({
            key: "captionLanguageMode",
            value
          })}
          type="radio"
          {value}
        />
        <div class="radio-dot"></div>
        <div class="radio-txt">
          <span class="radio-label">{label}</span>
          <span class="radio-desc">{description}</span>
        </div>
      </label>
    {/each}
  </div>
</fieldset>
