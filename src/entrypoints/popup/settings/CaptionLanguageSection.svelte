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

<fieldset class="settings-format-section">
  <legend class="settings-sub-legend">Closed captions language</legend>
  {#each captionLanguageModeOptions as { value, label, description } (value)}
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="caption-language-mode"
          checked={options.captionLanguageMode === value}
          onchange={() => void setOption({
            key: "captionLanguageMode",
            value
          })}
          type="radio"
          {value}
        />
        <span>
          {label}
          <span class="settings-option-description">{description}</span>
        </span>
      </label>
    </div>
  {/each}
</fieldset>
