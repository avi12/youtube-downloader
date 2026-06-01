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
      transition: transform 180ms cubic-bezier(0.34, 1.56, 0.64, 1);
      transform: scale(0);
    }
  }

  .radio-input-hidden:checked ~ .radio-dot {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .radio-input-hidden:checked ~ .radio-dot::after {
    transform: scale(1);
  }

  .radio-item:has(.radio-input-hidden:focus-visible) .radio-dot {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
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

  .set-inset {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    background: var(--surface-high);
  }

  .set-inset-label {
    flex: 1;
    color: var(--fg-muted);
    font-size: 0.8125rem;
  }

  .set-select {
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 0.8125rem;
    cursor: pointer;

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }
</style>
