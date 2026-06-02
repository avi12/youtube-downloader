<script lang="ts">
  import checkIcon from "../icons/check.svg?raw";
  import type { FormatItem } from "@/lib/utils/containers";

  interface Props {
    items: FormatItem[];
    pendingExtension: string | null;
    onSelect: (item: FormatItem) => void;
  }

  const { items, pendingExtension, onSelect }: Props = $props();
</script>

<div class="format-grid">
  {#each items as item (item.extension)}
    {@const isPending = pendingExtension === item.extension}
    {@const isHighlighted = item.isCurrent || isPending}
    <button
      class="format-card"
      class:format-card--selected={isHighlighted}
      class:format-card--slower={item.isSlow && !isHighlighted}
      aria-label="Transcode to {item.extension.toUpperCase()}"
      disabled={item.isCurrent || item.isExcluded || pendingExtension !== null}
      onclick={() => onSelect(item)}
      type="button"
    >
      <span class="format-name">
        {item.extension.toUpperCase()}
        {#if isHighlighted}
          <span class="format-check" aria-hidden="true">{@html checkIcon}</span>
        {/if}
      </span>
      {#if item.description}
        <span class="format-desc">{item.description}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .format-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 6px;
  }

  .format-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    color: var(--fg);
    font: inherit;
    text-align: start;
    cursor: pointer;
    transition: background-color 150ms, border-color 150ms, opacity 150ms;

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    &:disabled {
      cursor: not-allowed;
    }

    &:hover:not(:disabled) {
      border-color: var(--accent);
      background: var(--accent-hover);
    }
  }

  .format-card--selected {
    border-color: var(--accent);
    background: var(--accent-container);
  }

  .format-card--slower::after {
    content: "Slower";
    align-self: flex-start;
    margin-top: 4px;
    padding: 1px 6px;
    border-radius: 999px;
    background: color-mix(in oklab, oklch(82% 0.15 80deg) 35%, transparent);
    color: oklch(40% 0.16 60deg);
    font-weight: 600;
    font-size: 0.5625rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  @media (prefers-color-scheme: dark) {
    .format-card--slower::after {
      color: oklch(88% 0.16 80deg);
    }
  }

  .format-name {
    display: inline-flex;
    gap: 4px;
    justify-content: space-between;
    align-items: center;
    font-weight: 700;
    font-size: 0.8125rem;
    letter-spacing: 0.02em;
  }

  .format-check {
    display: inline-flex;
    color: var(--accent);

    :global(svg) {
      width: 12px;
      height: 12px;
    }
  }

  .format-desc {
    color: var(--fg-muted);
    font-size: 0.625rem;
    line-height: 1.3;
  }
</style>
