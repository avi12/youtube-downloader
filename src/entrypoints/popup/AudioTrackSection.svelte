<script lang="ts">
  import { setOption } from "@/lib/storage/storage";
  import { LANGUAGES } from "@/lib/utils/languages";
  import { AudioTrackLanguageMode } from "@/types";
  import type { Options } from "@/types";
  import { slide } from "svelte/transition";

  interface Props {
    options: Options;
    slideDuration: number;
  }

  const { options, slideDuration }: Props = $props();

  const languageModeOptions: Array<{
    value: AudioTrackLanguageMode;
    label: string;
    description: string;
  }> = [
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
  ];
</script>

<div class="settings-format-section">
  <span class="settings-sub-legend">Audio track language</span>
  {#each languageModeOptions as { value, label, description } (value)}
    <div class="settings-row">
      <label class="settings-label settings-radio-label">
        <input
          name="language-mode"
          checked={options.audioTrackLanguageMode === value}
          onchange={() => void setOption("audioTrackLanguageMode", value)}
          type="radio"
          {value}
        />
        <span>
          {label}
          <span class="settings-option-description">{description}</span>
        </span>
      </label>
    </div>
    {#if value === AudioTrackLanguageMode.Custom && options.audioTrackLanguageMode === AudioTrackLanguageMode.Custom}
      <div class="settings-sub-row" transition:slide={{ duration: slideDuration }}>
        <label class="settings-label" for="custom-language-select">Language</label>
        <select
          id="custom-language-select"
          class="settings-select"
          onchange={e => {
            if (e.target instanceof HTMLSelectElement) {
              void setOption("customLanguage", e.target.value);
            }
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
</div>
