<script lang="ts">
  import downloadIcon from "../icons/download.svg?raw";
  import openInNewIcon from "../icons/open-in-new.svg?raw";
  import { bindDownloadAccessors, getVideoStatusLabel } from "./active-downloads-helpers";
  import DownloadItem from "./DownloadItem.svelte";
  import RecentDownloadItem from "./recent/RecentDownloadItem.svelte";
  import type { DownloadProgressEntry, RecentDownloadEntry, VideoDetail, VideoQueueItem } from "@/types";
  import { SvelteMap } from "svelte/reactivity";

  interface Props {
    isFFmpegReady: boolean;
    videoDownloads: VideoQueueItem[];
    musicList: string[];
    videoOnlyList: string[];
    videoDetails: Record<string, VideoDetail>;
    statusProgress: Record<string, DownloadProgressEntry>;
    percentFormatter: Intl.NumberFormat;
    currentTabId?: number;
    currentSourceUrl?: string;
    recentDownloads: RecentDownloadEntry[];
    now: number;
    onCancel: (videoIds: string[]) => void;
    onShowRecentInFolder: (entry: RecentDownloadEntry) => void;
    onChangeFormat: (entry: RecentDownloadEntry) => void;
    onRemoveRecent: (entry: RecentDownloadEntry) => void;
  }

  const {
    isFFmpegReady, videoDownloads, musicList, videoOnlyList,
    videoDetails, statusProgress, percentFormatter, currentTabId, currentSourceUrl,
    recentDownloads, now,
    onCancel, onShowRecentInFolder, onChangeFormat, onRemoveRecent
  }: Props = $props();

  const accessors = $derived(
    bindDownloadAccessors({
      statusProgress,
      videoDetails,
      percentFormatter
    })
  );

  type ZipGroup = {
    playlistId: string;
    playlistTitle: string;
    videoIds: string[];
  };

  type Partition = {
    zipGroups: ZipGroup[];
    individualIds: string[];
    recent: RecentDownloadEntry[];
  };

  const videoDownloadIndex = $derived(
    new Map(videoDownloads.map((item, i) => [item.videoId, i] as const))
  );

  const allActiveIds = $derived([
    ...videoDownloads.map(item => item.videoId),
    ...musicList,
    ...videoOnlyList
  ]);

  function isInCurrentTab(detail: VideoDetail | undefined): boolean {
    if (currentTabId === undefined || !currentSourceUrl) {
      return false;
    }

    return detail?.tabId === currentTabId && detail?.sourceUrl === currentSourceUrl;
  }

  function isRecentInCurrentTab(entry: RecentDownloadEntry): boolean {
    return Boolean(
      currentTabId !== undefined
      && entry.tabId === currentTabId
      && currentSourceUrl
      && entry.sourceUrl === currentSourceUrl
    );
  }

  function partitionActive(videoIds: string[], recent: RecentDownloadEntry[]): Partition {
    const zipGroups = new SvelteMap<string, ZipGroup>();
    const individualIds: string[] = [];

    for (const id of videoIds) {
      const detail = videoDetails[id];
      const playlistId = detail?.playlistId;
      const playlistTitle = detail?.playlistTitle;
      if (playlistId && playlistTitle) {
        const group = zipGroups.get(playlistId);
        if (group) {
          group.videoIds.push(id);
          continue;
        }

        zipGroups.set(playlistId, {
          playlistId,
          playlistTitle,
          videoIds: [id]
        });
        continue;
      }

      individualIds.push(id);
    }

    return {
      zipGroups: [...zipGroups.values()],
      individualIds,
      recent
    };
  }

  const thisTabIds = $derived(allActiveIds.filter(id => isInCurrentTab(videoDetails[id])));
  const otherIds = $derived(allActiveIds.filter(id => !isInCurrentTab(videoDetails[id])));

  const thisTabRecent = $derived(recentDownloads.filter(isRecentInCurrentTab));

  const thisTab = $derived(partitionActive(thisTabIds, thisTabRecent));
  const otherTabs = $derived(partitionActive(otherIds, []));

  const thisTabCount = $derived(thisTab.individualIds.length + thisTab.zipGroups.length + thisTab.recent.length);
  const otherTabsCount = $derived(otherTabs.individualIds.length + otherTabs.zipGroups.length);

  function videoStatusLabel(videoId: string): string | null {
    const i = videoDownloadIndex.get(videoId);
    if (i === undefined) {
      return null;
    }

    if (accessors.progress(videoId) !== null) {
      return null;
    }

    return getVideoStatusLabel({
      i,
      isFFmpegReady
    });
  }

  function emitCancel(ids: string[]): void {
    onCancel(ids);
  }
</script>

{#snippet renderCard(videoId: string, showTabActions: boolean)}
  {@const detail = accessors.detail(videoId)}
  {@const entry = accessors.entry(videoId)}
  <DownloadItem
    bytesPerSecond={entry?.bytesPerSecond}
    channel={detail?.channel}
    downloadedBytes={entry?.downloadedBytes}
    filename={accessors.filename(videoId)}
    lengthSeconds={detail?.lengthSeconds}
    oncancel={() => emitCancel([videoId])}
    progress={accessors.progress(videoId)}
    progressLabel={accessors.label(videoId)}
    quality={accessors.quality(videoId)}
    {showTabActions}
    sourceUrl={detail?.sourceUrl}
    statusLabel={videoStatusLabel(videoId)}
    tabId={detail?.tabId}
    thumbnailUrl={detail?.thumbnailUrl}
    title={detail?.title}
    totalBytes={entry?.totalBytes}
    {videoId}
  />
{/snippet}

{#snippet renderSectionBody(partition: Partition, showTabActions: boolean)}
  {#each partition.zipGroups as group (group.playlistId)}
    <div class="zip-group">
      <span class="zip-group-label" data-tooltip="{group.playlistTitle}.zip">
        → {group.playlistTitle}.zip
      </span>
      <ul class="download-list" aria-label="Videos in {group.playlistTitle}.zip">
        {#each group.videoIds as videoId (videoId)}
          <li class="download-item">
            {@render renderCard(videoId, showTabActions)}
          </li>
        {/each}
      </ul>
    </div>
  {/each}

  {#if partition.individualIds.length > 0}
    <ul class="download-list">
      {#each partition.individualIds as videoId (videoId)}
        <li class="download-item">
          {@render renderCard(videoId, showTabActions)}
        </li>
      {/each}
    </ul>
  {/if}

  {#if partition.recent.length > 0}
    <ul class="recent-list" aria-label="Recent downloads from this tab">
      {#each partition.recent as entry (entry.id)}
        <li>
          <RecentDownloadItem
            {entry}
            {now}
            onChangeFormat={() => onChangeFormat(entry)}
            onRemove={() => onRemoveRecent(entry)}
            onShowInFolder={() => onShowRecentInFolder(entry)}
            showOpenInNew={showTabActions}
          />
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#if thisTabCount > 0}
  <section aria-labelledby="this-tab-heading">
    <header class="section-header">
      <h2 id="this-tab-heading" class="section-title">
        <span class="section-icon" aria-hidden="true">{@html downloadIcon}</span>
        This tab
        <span class="section-count">{thisTabCount}</span>
      </h2>
      {#if thisTabIds.length > 0}
        <button
          class="cancel-all-button"
          aria-label="Cancel all downloads from this tab"
          onclick={() => emitCancel(thisTabIds)}
          type="button"
        >
          Cancel all
        </button>
      {/if}
    </header>
    <div class="section-body">
      {@render renderSectionBody(thisTab, false)}
    </div>
  </section>
{/if}

{#if otherTabsCount > 0}
  <section aria-labelledby="other-tabs-heading">
    <header class="section-header">
      <h2 id="other-tabs-heading" class="section-title">
        <span class="section-icon" aria-hidden="true">{@html openInNewIcon}</span>
        Other tabs
        <span class="section-count">{otherTabsCount}</span>
      </h2>
      {#if otherIds.length > 0}
        <button
          class="cancel-all-button"
          aria-label="Cancel all downloads from other tabs"
          onclick={() => emitCancel(otherIds)}
          type="button"
        >
          Cancel all
        </button>
      {/if}
    </header>
    <div class="section-body">
      {@render renderSectionBody(otherTabs, true)}
    </div>
  </section>
{/if}

<style>
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;

    .section-title {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 0;
      color: var(--fg-muted);
      font-weight: 600;
      font-size: 0.75rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;

      .section-icon {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        color: var(--fg-muted);

        :global(svg) {
          width: 16px;
          height: 16px;
        }
      }

      .section-count {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        min-width: 18px;
        height: 18px;
        padding: 0 6px;
        border-radius: 9px;
        background: var(--accent-container);
        color: var(--fg);
        font-weight: 700;
        font-size: 0.6875rem;
        letter-spacing: 0;
        text-transform: none;
      }
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
  }

  .section-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .zip-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: 16px;

    .zip-group-label {
      overflow: hidden;
      padding: 0 4px;
      color: var(--fg-subtle);
      font-size: 0.6875rem;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  .download-list,
  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .download-item {
    display: block;
  }
</style>
