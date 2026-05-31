<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    sectionId: string;
    listAriaLabel: string;
    cancelAriaLabel: string;
    loadingBadge?: string;
    videoIds: string[];
    onCancelAll(): void;
    renderItem: Snippet<[string, number]>;
  }

  const {
    title,
    sectionId,
    listAriaLabel,
    cancelAriaLabel,
    loadingBadge,
    videoIds,
    onCancelAll,
    renderItem
  }: Props = $props();
</script>

{#if videoIds.length > 0}
  <section aria-labelledby="{sectionId}-heading">
    <header class="download-section-header">
      <h2 id="{sectionId}-heading" class="download-section-title">
        {title}
        {#if loadingBadge}
          <span class="download-section-loading-badge" aria-label={loadingBadge}>{loadingBadge}</span>
        {/if}
      </h2>
      <button
        class="download-section-cancel-all"
        aria-label={cancelAriaLabel}
        onclick={onCancelAll}
      >
        Cancel all
      </button>
    </header>

    <ul class="download-section-list" aria-label={listAriaLabel}>
      {#each videoIds as videoId, i (videoId)}
        {@render renderItem(videoId, i)}
      {/each}
    </ul>
  </section>
{/if}

<style>
  .download-section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;

    .download-section-title {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
      color: var(--fg);
      font-weight: 500;
      font-size: 0.8125rem;

      .download-section-loading-badge {
        color: var(--fg-subtle);
        font-weight: 400;
        font-size: 0.6875rem;
      }
    }

    .download-section-cancel-all {
      padding: 4px 12px;
      border: none;
      border-radius: 16px;
      background: transparent;
      color: var(--danger);
      font-family: inherit;
      font-size: 0.75rem;
      cursor: pointer;
      transition: background-color 200ms;

      &:hover {
        background: var(--danger-hover);
      }

      &:focus-visible {
        outline: 2px solid var(--danger);
        outline-offset: 2px;
      }
    }
  }

  .download-section-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    list-style: none;
  }
</style>
