<script lang="ts">
  import type { SlidingSettingsProps } from "./settings-types";
  import { setOption } from "@/lib/storage/storage";
  import { LANGUAGES } from "@/lib/utils/languages";
  import { AudioTrackLanguageMode } from "@/types";
  import { slide } from "svelte/transition";

  const { options, slideDuration }: SlidingSettingsProps = $props();

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
      description: "Falls back to English if the language is unavailable"
    }
  ] as const;
</script>

<fieldset class="settings-format-section">
  <legend class="settings-sub-legend">Audio track language</legend>
  {#each languageModeOptions as { value, label, description } (value)}
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="language-mode"
          checked={options.audioTrackLanguageMode === value}
          onchange={() => void setOption({
            key: "audioTrackLanguageMode",
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
    {@const isCustomMode = value === AudioTrackLanguageMode.Custom}
    {@const isCustomLanguageActive = isCustomMode && options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom}
    {#if isCustomLanguageActive}
      <div class="settings-sub-row" transition:slide={{ duration: slideDuration }}>
        <label class="settings-label" for="custom-language-select">Language</label>
        <select
          id="custom-language-select"
          class="settings-select"
          onchange={e => {
            const isSelectElement = e.target instanceof HTMLSelectElement;
            if (!isSelectElement) {
              return;
            }

            void setOption({
              key: "customLanguage",
              value: e.target.value
            });
          }}
          value={options.customLanguage}
        >
          {#each LANGUAGES as [name, code] (code)}
            <option selected={options.customLanguage === code} value={code}>{name}</option>
          {/each}
        </select>
      </div>
    {/if}
  {/each}
</fieldset>
