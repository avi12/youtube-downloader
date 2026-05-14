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
    <div class="download-section-header">
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
    </div>

    <ul class="download-section-list" aria-label={listAriaLabel} role="list">
      {#each videoIds as videoId, i (videoId)}
        {@render renderItem(videoId, i)}
      {/each}
    </ul>
  </section>
{/if}
