<script lang="ts">
  import PlaylistOverrideBadge from "./PlaylistOverrideBadge.svelte";

  interface Props {
    isDisabled: boolean;
    isOverridden: boolean;
    value: string;
    onchange: (value: string) => void;
  }

  const { isDisabled, isOverridden, value, onchange }: Props = $props();
</script>

<div class="ytdl-zip-name">
  <label class="ytdl-zip-name-label" for="ytdl-zip-name-input">Filename</label>
  <div class="ytdl-zip-name-row">
    <div class="ytdl-zip-name-field">
      <input
        id="ytdl-zip-name-input"
        class="ytdl-zip-name-input"
        aria-label="ZIP filename without extension"
        dir="auto"
        disabled={isDisabled}
        oninput={e => {
          if (e.target instanceof HTMLInputElement) {
            onchange(e.target.value);
          }
        }}
        spellcheck={false}
        type="text"
        {value}
      />
      <span class="ytdl-zip-ext" aria-hidden="true"></span>
    </div>
    {#if isOverridden}
      <PlaylistOverrideBadge />
    {/if}
  </div>
</div>

<style>
  .ytdl-zip-name {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ytdl-zip-name-label {
    color: var(--yt-sys-color-baseline--text-secondary, #aaaaaa);
    font-size: 1.2rem;
  }

  .ytdl-zip-name-row {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .ytdl-zip-name-field {
    --zip-inset-start: auto;
    --zip-inset-end: 0px;
    --zip-padding-start: 0;
    --zip-padding-end: 1.6em;
    --zip-label: ".zip";

    position: relative;
    display: flex;
    flex: 1;
    border-bottom: 1px solid var(--yt-sys-color-baseline--text-secondary, #aaaaaa);

    &:has(:dir(rtl)) {
      --zip-inset-start: 0px;
      --zip-inset-end: auto;
      --zip-padding-start: 1.6em;
      --zip-padding-end: 0;
      --zip-label: "zip.";
    }

    &:focus-within {
      border-bottom: 2px solid var(--yt-sys-color-baseline--call-to-action, rgb(62 166 255));
    }

    &:has(input:disabled) {
      opacity: 38%;
      cursor: not-allowed;
    }
  }

  .ytdl-zip-name-input {
    flex: 1;
    min-width: 0;
    padding-block: 2px 4px;
    padding-inline-end: var(--zip-padding-end);
    padding-inline-start: var(--zip-padding-start);
    border: none;
    background: transparent;
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    outline: none;
    font-family: inherit;
    font-size: 1.4rem;

    &:disabled {
      cursor: not-allowed;
    }
  }

  .ytdl-zip-ext {
    position: absolute;
    inset-block: 0;
    inset-inline-end: var(--zip-inset-end);
    inset-inline-start: var(--zip-inset-start);
    display: flex;
    align-items: flex-end;
    padding-block-end: 4px;
    padding-inline-end: 2px;
    color: var(--yt-sys-color-baseline--text-secondary, #aaaaaa);
    font-size: 1.4rem;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;

    &::before {
      content: var(--zip-label);
    }
  }
</style>
