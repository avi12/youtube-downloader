<script lang="ts">
  import RecentDownloadItem from "./RecentDownloadItem.svelte";
  import type { RecentDownloadEntry } from "@/types";

  interface Props {
    recentDownloads: RecentDownloadEntry[];
    now: number;
    onChangeFormat: (entry: RecentDownloadEntry) => void;
    onRemove: (entry: RecentDownloadEntry) => void;
    onShowInFolder: (entry: RecentDownloadEntry) => void;
  }

  const { recentDownloads, now, onChangeFormat, onRemove, onShowInFolder }: Props = $props();
</script>

{#if recentDownloads.length > 0}
  <section class="recent-section" aria-labelledby="recent-section-heading">
    <h2 id="recent-section-heading" class="recent-section-heading">Recent</h2>
    <ul class="recent-list" role="list">
      {#each recentDownloads as entry (entry.id)}
        <li role="listitem">
          <RecentDownloadItem
            {entry}
            {now}
            onChangeFormat={() => onChangeFormat(entry)}
            onRemove={() => onRemove(entry)}
            onShowInFolder={() => onShowInFolder(entry)}
          />
        </li>
      {/each}
    </ul>
  </section>
{/if}
