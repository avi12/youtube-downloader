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

<fieldset class="set-section-fieldset">
  <legend class="radio-group-legend">Audio track language</legend>
  <div class="radio-group" role="radiogroup">
    {#each languageModeOptions as { value, label, description } (value)}
      <label class="radio-item">
        <input
          name="language-mode"
          class="radio-input-hidden"
          checked={options.audioTrackLanguageMode === value}
          onchange={() => void setOption({
            key: "audioTrackLanguageMode",
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
  {#if options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom}
    <div class="set-inset" transition:slide={{ duration: slideDuration }}>
      <label class="set-inset-label" for="custom-language-select">Language</label>
      <select
        id="custom-language-select"
        class="set-select"
        onchange={e => {
          if (!(e.target instanceof HTMLSelectElement)) {
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
</fieldset>
