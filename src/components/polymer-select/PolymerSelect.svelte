<script lang="ts">
  import { createPolymerSelectState } from "./PolymerSelect.svelte.ts";

  interface Props {
    id?: string;
    label: string;
    options: {
      value: string;
      label: string;
    }[];
    value: string;
    disabled?: boolean;
    onchange: (value: string) => void;
  }

  const { id, label, options, value, disabled = false, onchange }: Props = $props();

  const selectedLabel = $derived(options.find(option => option.value === value)?.label ?? "");

  const state = createPolymerSelectState({
    get value() {
      return value;
    },
    get onchange() {
      return onchange;
    }
  });
</script>

<div class="ytdl-select-field">
  <label class="ytdl-select-label" for={id}>{label}</label>
  <button
    {id}
    class="ytdl-select-trigger"
    class:open={state.isOpen}
    {@attach state.attachTrigger}
    aria-expanded={state.isOpen}
    aria-haspopup="listbox"
    aria-label={label}
    disabled={disabled || undefined}
    type="button"
  >
    <span class="value">{selectedLabel}</span>
    <svg
      class="chevron"
      class:open={state.isOpen}
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </button>

  {#if state.isOpen}
    <tp-yt-paper-listbox
      class="ytdl-select-menu"
      {@attach state.attachMenu}
      aria-label={label}
      attr-for-selected="data-value"
      role="listbox"
      selected={value}
    >
      {#each options as option (option.value)}
        <tp-yt-paper-item
          aria-selected={option.value === value}
          data-value={option.value}
          role="option"
          tabindex={option.value === value ? 0 : -1}
        >{option.label}</tp-yt-paper-item>
      {/each}
    </tp-yt-paper-listbox>
  {/if}
</div>

<style>
  .ytdl-select-field {
    position: relative;

    &:has(.ytdl-select-trigger:disabled) {
      opacity: var(--paper-dropdown-menu-disabled-opacity, 33%);
    }
  }

  .ytdl-select-label {
    display: block;
    margin-block-end: 6px;
    color: var(--yt-sys-color-baseline--text-secondary, #606060);
    font-weight: 500;
    font-size: 1.2rem;
  }

  .ytdl-select-trigger {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    height: 40px;
    margin: 0;
    padding-block: 0;
    padding-inline: 14px 12px;
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 16%));
    border-radius: 8px;
    background: transparent;
    color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
    font: inherit;
    font-size: 1.4rem;
    text-align: start;
    cursor: pointer;

    &:hover {
      border-color: var(--yt-sys-color-baseline--text-secondary, #606060);
    }

    &.open {
      border-color: var(--yt-sys-color-baseline--call-to-action, #065fd4);
    }

    &:disabled {
      cursor: default;
    }

    .value {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chevron {
      flex-shrink: 0;
      margin-inline-start: 8px;
      color: var(--yt-sys-color-baseline--text-secondary, #606060);
      transition: rotate 120ms ease-out;

      &.open {
        rotate: 180deg;
      }
    }
  }

  .ytdl-select-menu {
    position: absolute;
    inset-inline: 0;
    inset-block-start: calc(100% + 4px);
    z-index: 10;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 10%));
    border-radius: 8px;
    background: var(--yt-sys-color-baseline--raised-background, var(--yt-sys-color-baseline--base-background, #ffffff));
    scrollbar-width: thin;
    box-shadow: 0 8px 32px rgb(0 0 0 / 32%), 0 2px 8px rgb(0 0 0 / 16%);

    & :global(tp-yt-paper-item) {
      display: flex;
      align-items: center;
      min-height: 0;
      padding: 8px 10px;
      border-radius: 6px;
      color: var(--yt-sys-color-baseline--text-primary, #0f0f0f);
      font-size: 1.4rem;
      white-space: nowrap;
      cursor: pointer;
    }

    & :global(tp-yt-paper-item:hover) {
      background-color: var(--yt-sys-color-baseline--tonal-rim, rgb(0 0 0 / 6%));
    }

    & :global(tp-yt-paper-item[aria-selected="true"]) {
      font-weight: 500;
    }
  }
</style>
