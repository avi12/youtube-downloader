<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    title: string;
    sectionId: string;
    listAriaLabel: string;
    cancelAriaLabel: string;
    loadingBadge?: string;
    videoIds: string[];
    onCancelAll(): void;
    renderItem: Snippet<[string, number]>;
  };

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
    <div class="section-header">
      <h2 id="{sectionId}-heading" class="section-title">
        {title}
        {#if loadingBadge}
          <span class="loading-badge" aria-label={loadingBadge}>{loadingBadge}</span>
        {/if}
      </h2>
      <button
        class="cancel-all-button"
        aria-label={cancelAriaLabel}
        onclick={onCancelAll}
      >
        Cancel all
      </button>
    </div>

    <ul class="download-list" aria-label={listAriaLabel} role="list">
      {#each videoIds as videoId, index (videoId)}
        {@render renderItem(videoId, index)}
      {/each}
    </ul>
  </section>
{/if}

<style>
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .section-title {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--fg);
    font-weight: 500;
    font-size: 0.8125rem;
  }

  .loading-badge {
    color: var(--fg-subtle);
    font-weight: 400;
    font-size: 0.6875rem;
  }

  .cancel-all-button {
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

  .download-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    list-style: none;
  }
</style>
