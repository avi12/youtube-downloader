<script lang="ts">
  import { setOption } from "@/lib/storage/storage";
  import { LANGUAGES } from "@/lib/utils/languages";
  import { AudioTrackLanguageMode, CaptionLanguageMode } from "@/types";
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

<fieldset class="settings-group">
  <legend class="settings-legend">Audio &amp; subtitles</legend>
  <label class="settings-row">
    <span class="settings-label">Download additional audio tracks and captions</span>
    <span class="settings-switch" aria-label="Download additional audio tracks and captions">
      <input
        checked={options.downloadExtras}
        onchange={e => {
          if (e.target instanceof HTMLInputElement) {
            void setOption("downloadExtras", e.target.checked);
          }
        }}
        role="switch"
        type="checkbox"
      />
      <span class="settings-switch-track">
        <span class="settings-switch-thumb"></span>
      </span>
    </span>
  </label>
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
</fieldset>
