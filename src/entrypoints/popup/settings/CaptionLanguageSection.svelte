<script lang="ts">
  import { setOption } from "@/lib/storage/storage";
  import { CaptionLanguageMode } from "@/types";
  import type { Options } from "@/types";

  interface Props {
    options: Options;
  }

  const { options }: Props = $props();

  const captionLanguageModeOptions: Array<{
    value: CaptionLanguageMode;
    label: string;
    description: string;
  }> = [
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
  ];
</script>

<div class="settings-format-section">
  <span class="settings-sub-legend">Closed captions language</span>
  {#each captionLanguageModeOptions as { value, label, description } (value)}
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="caption-language-mode"
          checked={options.captionLanguageMode === value}
          onchange={() => void setOption("captionLanguageMode", value)}
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
</div>
