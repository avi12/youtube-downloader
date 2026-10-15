<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    label: string;
    hint?: string;
    isHintError?: boolean;
    children: Snippet;
  }

  const { label, hint, isHintError = false, children }: Props = $props();
</script>

<label class="option-field">
  <span class="option-label">{label}</span>
  {@render children()}
  {#if hint}
    <span class="option-hint" class:option-hint--error={isHintError}>{hint}</span>
  {/if}
</label>

<style>
  .option-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;

    :global(:is(input, select)) {
      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      height: 36px;
      padding-block: 0;
      padding-inline: 10px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--surface);
      color: var(--fg);
      font: inherit;
      font-size: 0.8125rem;
      transition: border-color 200ms;

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }

      &:disabled {
        opacity: 60%;
        cursor: not-allowed;
      }

      &[aria-invalid="true"] {
        border-color: var(--danger);
      }

      &:hover:enabled:not(:focus-visible, [aria-invalid="true"]) {
        border-color: var(--fg-subtle);
      }
    }
  }

  .option-label {
    color: var(--fg-muted);
    font-weight: 600;
    font-size: 0.6875rem;
    letter-spacing: 0.04em;
  }

  .option-hint {
    color: var(--fg-subtle);
    font-size: 0.6875rem;
    line-height: 1.35;

    &.option-hint--error {
      color: var(--danger);
    }
  }
</style>
