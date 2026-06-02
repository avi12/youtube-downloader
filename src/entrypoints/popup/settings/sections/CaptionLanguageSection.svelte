<script lang="ts">
  import type { SettingsProps } from "../settings-types";
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
          onchange={() => {
            void setOption({
              key: "captionLanguageMode",
              value
            });
          }}
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

<style>
  .set-section-fieldset {
    margin: 0;
    padding: 0;
    border: none;
    border-top: 1px solid var(--border);

    &:first-child {
      border-top: none;
    }
  }

  .radio-group-legend {
    padding-block: 10px 2px;
    padding-inline: 14px;
    color: var(--fg-muted);
    font-weight: 500;
    font-size: 0.75rem;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    min-inline-size: auto;
    margin: 0;
    padding: 4px;
    border: none;
  }

  .radio-item {
    display: flex;
    gap: 13px;
    align-items: flex-start;
    padding: 9px 10px;
    border-radius: 12px;
    cursor: pointer;

    &:hover {
      background: var(--surface-high);
    }
  }

  .radio-input-hidden {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0%;
  }

  .radio-dot {
    position: relative;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 2px var(--fg-subtle);
    transition: box-shadow 150ms;

    &::after {
      content: "";
      position: absolute;
      inset: 0;
      width: 10px;
      height: 10px;
      margin: auto;
      border-radius: 50%;
      background: var(--accent);
      transition: scale 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
      scale: 0;
    }

    .radio-input-hidden:checked ~ & {
      box-shadow: inset 0 0 0 2px var(--accent);

      &::after {
        scale: 1;
      }
    }

    .radio-item:has(.radio-input-hidden:focus-visible) & {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .radio-txt {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .radio-label {
    color: var(--fg);
    font-weight: 500;
    font-size: 0.84375rem;
  }

  .radio-desc {
    color: var(--fg-muted);
    font-size: 0.71875rem;
  }
</style>
