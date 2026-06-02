<script lang="ts">
  import { TranscodeSpeed } from "@/lib/utils/containers";
  import type { FormatItem } from "@/lib/utils/containers";

  interface Props {
    items: FormatItem[];
    pendingExtension: string | null;
    onSelect: (item: FormatItem) => void;
  }

  const { items, pendingExtension, onSelect }: Props = $props();

  const INSTANT_ICON = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="currentColor" viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>`;
  const REENCODE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.36 6.36L3 21M3 12a9 9 0 0 1 15.36-6.36L21 3"/><path d="M21 3v6h-6M3 21v-6h6"/></svg>`;
  const SLOWER_ICON = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`;

  type TagKind = "current" | "instant" | "re-encodes" | "slower";

  function getTagKind(item: FormatItem): TagKind {
    if (item.isCurrent) {
      return "current";
    }

    if (item.transcodeSpeed === TranscodeSpeed.Slower) {
      return "slower";
    }

    if (item.transcodeSpeed === TranscodeSpeed.ReEncodes) {
      return "re-encodes";
    }

    return "instant";
  }

  const TAG_LABEL: Record<TagKind, string> = {
    current: "Current",
    instant: "Instant",
    "re-encodes": "Re-encodes",
    slower: "Slower"
  };

  function getTagIcon(kind: TagKind) {
    if (kind === "current") {
      return "";
    }

    if (kind === "instant") {
      return INSTANT_ICON;
    }

    if (kind === "re-encodes") {
      return REENCODE_ICON;
    }

    return SLOWER_ICON;
  }
</script>

<div class="format-grid">
  {#each items as item (item.extension)}
    {@const tag = getTagKind(item)}
    {@const isPending = pendingExtension === item.extension}
    <button
      class="format-card format-card--{tag}"
      class:format-card--pending={isPending}
      aria-label="Transcode to {item.extension.toUpperCase()}"
      disabled={item.isCurrent || item.isExcluded || pendingExtension !== null}
      onclick={() => onSelect(item)}
      type="button"
    >
      <div class="format-card-head">
        <span class="format-name">{item.extension.toUpperCase()}</span>
        <span class="format-tag format-tag--{tag}">
          {#if tag !== "current"}
            <span class="format-tag-icon" aria-hidden="true">{@html getTagIcon(tag)}</span>
          {/if}
          {TAG_LABEL[tag]}
        </span>
      </div>
      {#if item.description}
        <span class="format-desc">{item.description}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .format-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }

  .format-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 14px;
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

  .format-card--current {
    opacity: 80%;
  }

  .format-card--pending {
    border-color: var(--accent);
    background: var(--accent-container);
  }

  .format-card--slower {
    border-color: color-mix(in oklab, oklch(75% 0.16 60deg) 60%, transparent);
  }

  .format-card-head {
    display: flex;
    gap: 6px;
    justify-content: space-between;
    align-items: center;
  }

  .format-name {
    font-weight: 700;
    font-size: 0.875rem;
    letter-spacing: 0.02em;
  }

  .format-desc {
    color: var(--fg-muted);
    font-size: 0.6875rem;
    line-height: 1.3;
  }

  .format-tag {
    display: inline-flex;
    flex-shrink: 0;
    gap: 3px;
    align-items: center;
    padding: 2px 7px;
    border-radius: 999px;
    font-weight: 600;
    font-size: 0.5625rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;

    .format-tag-icon {
      display: inline-flex;

      :global(svg) {
        width: 9px;
        height: 9px;
      }
    }
  }

  .format-tag--current {
    background: var(--accent-container);
    color: var(--accent);
  }

  .format-tag--instant {
    background: color-mix(in oklab, oklch(75% 0.18 145deg) 50%, transparent);
    color: oklch(32% 0.18 145deg);
  }

  .format-tag--re-encodes {
    background: var(--surface-high);
    color: var(--fg-muted);
  }

  .format-tag--slower {
    background: color-mix(in oklab, oklch(80% 0.16 75deg) 55%, transparent);
    color: oklch(36% 0.16 60deg);
  }

  @media (prefers-color-scheme: dark) {
    .format-tag--current {
      color: var(--md-sys-color-on-primary, var(--fg));
    }

    .format-tag--instant {
      color: oklch(88% 0.2 145deg);
    }

    .format-tag--slower {
      color: oklch(90% 0.16 80deg);
    }
  }
</style>
