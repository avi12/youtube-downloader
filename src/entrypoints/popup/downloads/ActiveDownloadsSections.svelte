<script lang="ts">
  import { bindDownloadAccessors, getVideoStatusLabel } from "./active-downloads-helpers";
  import DownloadItem from "./DownloadItem.svelte";
  import DownloadSection from "./DownloadSection.svelte";
  import RecentDownloadItem from "./recent/RecentDownloadItem.svelte";
  import type { DownloadProgressEntry, RecentDownloadEntry, VideoQueueItem } from "@/types";
  import { SvelteMap, SvelteSet } from "svelte/reactivity";

  interface Props {
    isFFmpegReady: boolean;
    videoDownloads: VideoQueueItem[];
    musicList: string[];
    videoOnlyList: string[];
    videoDetails: Record<string, {
      filenameOutput: string;
      quality?: string;
      tabId?: number;
      playlistId?: string;
      playlistTitle?: string;
      sourceUrl?: string;
    }>;
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

  function matchesCurrentTab(detail: {
    tabId?: number;
    sourceUrl?: string;
  } | undefined): boolean {
    return detail?.tabId === currentTabId && detail?.sourceUrl === currentSourceUrl;
  }

  function isVideoIdInThisTab(videoId: string): boolean {
    if (currentTabId === undefined || !currentSourceUrl) {
      return false;
    }

    return matchesCurrentTab(videoDetails[videoId]);
  }

  function isRecentEntryInThisTab(entry: RecentDownloadEntry): boolean {
    return Boolean(
      currentTabId !== undefined
      && entry.tabId === currentTabId
      && currentSourceUrl
      && entry.sourceUrl === currentSourceUrl
    );
  }

  function addMatchingTabIds(ids: SvelteSet<string>, list: Iterable<string>): void {
    for (const id of list) {
      if (isVideoIdInThisTab(id)) {
        ids.add(id);
      }
    }
  }

  type ZipGroup = {
    playlistTitle: string;
    videoIds: string[];
  };

  function upsertGroup(zipGroups: SvelteMap<string, ZipGroup>, playlistId: string, playlistTitle: string, id: string): void {
    const group = zipGroups.get(playlistId);
    if (group) {
      group.videoIds.push(id);
    } else {
      zipGroups.set(playlistId, {
        playlistTitle,
        videoIds: [id]
      });
    }
  }

  function addToGroups(zipGroups: SvelteMap<string, ZipGroup>, individualIds: string[], id: string): void {
    const { playlistId, playlistTitle } = videoDetails[id] ?? {};
    if (!playlistId || !playlistTitle) {
      individualIds.push(id);
      return;
    }

    upsertGroup(zipGroups, playlistId, playlistTitle, id);
  }

  const thisTabRecent = $derived(
    currentTabId === undefined || !currentSourceUrl
      ? []
      : recentDownloads.filter(isRecentEntryInThisTab)
  );

  const accessors = $derived(
    bindDownloadAccessors({
      statusProgress,
      videoDetails,
      percentFormatter
    })
  );

  const thisTabIds = $derived(
    (() => {
      if (currentTabId === undefined || !currentSourceUrl) {
        return new SvelteSet<string>();
      }

      const ids = new SvelteSet<string>();
      addMatchingTabIds(ids, videoDownloads.map(item => item.videoId));
      addMatchingTabIds(ids, musicList);
      addMatchingTabIds(ids, videoOnlyList);
      return ids;
    })()
  );

  const thisTabVideoIds = $derived(
    thisTabIds.size === 0
      ? []
      : [...videoDownloads.map(item => item.videoId), ...musicList, ...videoOnlyList]
        .filter(id => thisTabIds.has(id))
  );

  const thisTabGroups = $derived(
    (() => {
      const zipGroups = new SvelteMap<string, ZipGroup>();
      const individualIds: string[] = [];
      for (const id of thisTabVideoIds) {
        addToGroups(zipGroups, individualIds, id);
      }
      return {
        zipGroups: [...zipGroups.values()],
        individualIds
      };
    })()
  );

  const isThisTabKnown = $derived(thisTabIds.size > 0);
  const otherVideoDownloadIds = $derived(
    isThisTabKnown
      ? videoDownloads.filter(item => !thisTabIds.has(item.videoId)).map(item => item.videoId)
      : videoDownloads.map(item => item.videoId)
  );
  const otherMusicList = $derived(
    isThisTabKnown ? musicList.filter(id => !thisTabIds.has(id)) : musicList
  );
  const otherVideoOnlyList = $derived(
    isThisTabKnown ? videoOnlyList.filter(id => !thisTabIds.has(id)) : videoOnlyList
  );
  const videoDownloadIds = $derived(videoDownloads.map(item => item.videoId));
</script>

{#if thisTabVideoIds.length > 0 || thisTabRecent.length > 0}
  <section aria-labelledby="this-tab-heading">
    <header class="section-header">
      <h2 id="this-tab-heading" class="section-title">
        This tab
        <span class="section-count">{thisTabVideoIds.length + thisTabRecent.length}</span>
      </h2>
      {#if thisTabVideoIds.length > 0}
        <button
          class="cancel-all-button"
          aria-label="Cancel all downloads from this tab"
          onclick={() => onCancel(thisTabVideoIds)}
        >
          Cancel all
        </button>
      {/if}
    </header>

    <div class="this-tab-content">
      {#each thisTabGroups.zipGroups as group (group.playlistTitle)}
        <div class="zip-group">
          <span class="zip-group-label" data-tooltip="{group.playlistTitle}.zip">
            → {group.playlistTitle}.zip
          </span>
          <ul class="download-list" aria-label="Videos in {group.playlistTitle}.zip">
            {#each group.videoIds as videoId (videoId)}
              <li class="download-item">
                <DownloadItem
                  filename={accessors.filename(videoId)}
                  oncancel={() => onCancel([videoId])}
                  progress={accessors.progress(videoId)}
                  progressLabel={accessors.label(videoId)}
                  quality={accessors.quality(videoId)}
                />
              </li>
            {/each}
          </ul>
        </div>
      {/each}

      {#if thisTabGroups.individualIds.length > 0}
        <ul class="download-list" aria-label="Individual downloads from this tab">
          {#each thisTabGroups.individualIds as videoId (videoId)}
            <li class="download-item">
              <DownloadItem
                filename={accessors.filename(videoId)}
                oncancel={() => onCancel([videoId])}
                progress={accessors.progress(videoId)}
                progressLabel={accessors.label(videoId)}
                quality={accessors.quality(videoId)}
                {videoId}
              />
            </li>
          {/each}
        </ul>
      {/if}

      {#if thisTabRecent.length > 0}
        <ul class="recent-list" aria-label="Recent downloads from this tab">
          {#each thisTabRecent as entry (entry.id)}
            <li>
              <RecentDownloadItem
                {entry}
                {now}
                onChangeFormat={() => onChangeFormat(entry)}
                onRemove={() => onRemoveRecent(entry)}
                onShowInFolder={() => onShowRecentInFolder(entry)}
              />
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </section>
{/if}

<DownloadSection
  cancelAriaLabel="Cancel all video downloads"
  listAriaLabel="Active video downloads"
  loadingBadge={!isFFmpegReady ? "Loading FFmpeg…" : undefined}
  onCancelAll={() => onCancel(videoDownloadIds)}
  sectionId="video-downloads"
  title="Video downloads"
  videoIds={otherVideoDownloadIds}
>
  {#snippet renderItem(videoId, i)}
    <li
      class="download-item"
      aria-label={accessors.filename(videoId)}
    >
      <DownloadItem
        filename={accessors.filename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={accessors.progress(videoId)}
        progressLabel={accessors.label(videoId)}
        quality={accessors.quality(videoId)}
        statusLabel={accessors.progress(videoId) === null ? getVideoStatusLabel({
          i,
          isFFmpegReady
        }) : null}
        {videoId}
      />
    </li>
  {/snippet}
</DownloadSection>

<DownloadSection
  cancelAriaLabel="Cancel all audio downloads"
  listAriaLabel="Audio downloads"
  onCancelAll={() => onCancel(musicList)}
  sectionId="music-list"
  title="Audio"
  videoIds={otherMusicList}
>
  {#snippet renderItem(videoId)}
    <li class="download-item">
      <DownloadItem
        filename={accessors.filename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={accessors.progress(videoId)}
        progressLabel={accessors.label(videoId)}
        {videoId}
      />
    </li>
  {/snippet}
</DownloadSection>

<DownloadSection
  cancelAriaLabel="Cancel all video-only downloads"
  listAriaLabel="Video-only downloads"
  onCancelAll={() => onCancel(videoOnlyList)}
  sectionId="video-only"
  title="Video only"
  videoIds={otherVideoOnlyList}
>
  {#snippet renderItem(videoId)}
    <li class="download-item">
      <DownloadItem
        filename={accessors.filename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={accessors.progress(videoId)}
        progressLabel={accessors.label(videoId)}
        {videoId}
      />
    </li>
  {/snippet}
</DownloadSection>

<style>
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;

    .section-title {
      display: flex;
      gap: 6px;
      align-items: center;
      margin: 0;
      color: var(--fg-muted);
      font-weight: 600;
      font-size: 0.75rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;

      .section-count {
        display: inline-flex;
        justify-content: center;
        align-items: center;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
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

  .this-tab-content {
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
    border-radius: 12px;

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
    gap: 4px;
    padding: 0;
    list-style: none;
  }

  .download-item {
    display: block;
  }
</style>
