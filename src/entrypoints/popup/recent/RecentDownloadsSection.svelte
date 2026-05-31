<script lang="ts">
  import RecentDownloadItem from "./RecentDownloadItem.svelte";
  import type { RecentDownloadEntry } from "@/types";

  interface Props {
    recentDownloads: RecentDownloadEntry[];
    now: number;
    currentTabId?: number;
    currentSourceUrl?: string;
    onChangeFormat: (entry: RecentDownloadEntry) => void;
    onRemove: (entry: RecentDownloadEntry) => void;
    onShowInFolder: (entry: RecentDownloadEntry) => void;
  }

  const {
    recentDownloads, now, currentTabId, currentSourceUrl,
    onChangeFormat, onRemove, onShowInFolder
  }: Props = $props();

  function isInCurrentTab(entry: RecentDownloadEntry): boolean {
    return Boolean(
      currentTabId !== undefined
      && entry.tabId === currentTabId
      && currentSourceUrl
      && entry.sourceUrl === currentSourceUrl
    );
  }

  const otherRecent = $derived(
    currentTabId === undefined || !currentSourceUrl
      ? recentDownloads
      : recentDownloads.filter(entry => !isInCurrentTab(entry))
  );
</script>

{#if otherRecent.length > 0}
  <section class="recent-section" aria-labelledby="recent-section-heading">
    <h2 id="recent-section-heading" class="recent-section-heading">Recent</h2>
    <ul class="recent-list">
      {#each otherRecent as entry (entry.id)}
        <li>
          <RecentDownloadItem
            {entry}
            {now}
            onChangeFormat={() => onChangeFormat(entry)}
            onRemove={() => onRemove(entry)}
            onShowInFolder={() => onShowInFolder(entry)}
            showOpenInNew
          />
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .recent-section {
    display: flex;
    flex-direction: column;
    gap: 8px;

    .recent-section-heading {
      margin: 0;
      padding: 0 4px;
      color: var(--fg-muted);
      font-weight: 500;
      font-size: 0.8125rem;
    }

    .recent-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
  }
</style>
