<script lang="ts">
  import { bindDownloadAccessors, getVideoStatusLabel } from "./active-downloads-helpers";
  import DownloadItem from "./DownloadItem.svelte";
  import DownloadSection from "./DownloadSection.svelte";
  import { ProgressType } from "@/types";
  import type { VideoQueueItem } from "@/types";
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
    }>;
    statusProgress: Record<string, {
      progress: number;
      progressType: ProgressType;
    }>;
    percentFormatter: Intl.NumberFormat;
    currentTabId?: number;
    onCancel: (videoIds: string[]) => void;
  }

  const {
    isFFmpegReady, videoDownloads, musicList, videoOnlyList,
    videoDetails, statusProgress, percentFormatter, currentTabId, onCancel
  }: Props = $props();

  const accessors = $derived(
    bindDownloadAccessors({
      statusProgress,
      videoDetails,
      percentFormatter
    })
  );

  const thisTabIds = $derived(
    (() => {
      if (currentTabId === undefined) {
        return new SvelteSet<string>();
      }

      const ids = new SvelteSet<string>();
      for (const item of videoDownloads) {
        if (videoDetails[item.videoId]?.tabId === currentTabId) {
          ids.add(item.videoId);
        }
      }

      for (const id of musicList) {
        if (videoDetails[id]?.tabId === currentTabId) {
          ids.add(id);
        }
      }

      for (const id of videoOnlyList) {
        if (videoDetails[id]?.tabId === currentTabId) {
          ids.add(id);
        }
      }

      return ids;
    })()
  );

  const thisTabVideoIds = $derived(
    (() => {
      if (thisTabIds.size === 0) {
        return [];
      }

      const ids: string[] = [];
      for (const item of videoDownloads) {
        if (thisTabIds.has(item.videoId)) {
          ids.push(item.videoId);
        }
      }

      for (const id of musicList) {
        if (thisTabIds.has(id)) {
          ids.push(id);
        }
      }

      for (const id of videoOnlyList) {
        if (thisTabIds.has(id)) {
          ids.push(id);
        }
      }

      return ids;
    })()
  );

  const thisTabGroups = $derived(
    (() => {
      const zipGroups = new SvelteMap<string, {
        playlistTitle: string;
        videoIds: string[];
      }>();
      const individualIds: string[] = [];

      for (const id of thisTabVideoIds) {
        const detail = videoDetails[id];
        if (detail?.playlistId && detail.playlistTitle) {
          const group = zipGroups.get(detail.playlistId);
          if (group) {
            group.videoIds.push(id);
          } else {
            zipGroups.set(detail.playlistId, {
              playlistTitle: detail.playlistTitle,
              videoIds: [id]
            });
          }
        } else {
          individualIds.push(id);
        }
      }

      return {
        zipGroups: [...zipGroups.values()],
        individualIds
      };
    })()
  );

  const otherVideoDownloadIds = $derived(
    thisTabIds.size > 0
      ? videoDownloads.filter(item => !thisTabIds.has(item.videoId)).map(item => item.videoId)
      : videoDownloads.map(item => item.videoId)
  );
  const otherMusicList = $derived(
    thisTabIds.size > 0 ? musicList.filter(id => !thisTabIds.has(id)) : musicList
  );
  const otherVideoOnlyList = $derived(
    thisTabIds.size > 0 ? videoOnlyList.filter(id => !thisTabIds.has(id)) : videoOnlyList
  );
  const videoDownloadIds = $derived(videoDownloads.map(item => item.videoId));
</script>

{#if thisTabVideoIds.length > 0}
  <section aria-labelledby="this-tab-heading">
    <div class="section-header">
      <h2 id="this-tab-heading" class="section-title">This tab</h2>
      <button
        class="cancel-all-button"
        aria-label="Cancel all downloads from this tab"
        onclick={() => onCancel(thisTabVideoIds)}
      >
        Cancel all
      </button>
    </div>

    <div class="this-tab-content">
      {#each thisTabGroups.zipGroups as group (group.playlistTitle)}
        <div class="zip-group">
          <span class="zip-group-label" title="{group.playlistTitle}.zip">
            → {group.playlistTitle}.zip
          </span>
          <ul class="download-list" aria-label="Videos in {group.playlistTitle}.zip" role="list">
            {#each group.videoIds as videoId (videoId)}
              <li class="download-item" role="listitem">
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
        <ul class="download-list" aria-label="Individual downloads from this tab" role="list">
          {#each thisTabGroups.individualIds as videoId (videoId)}
            <li class="download-item" role="listitem">
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
      class:download-item--active={i === 0}
      aria-label={accessors.filename(videoId)}
      role="listitem"
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
    <li class="download-item" role="listitem">
      <DownloadItem
        filename={accessors.filename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={accessors.progress(videoId)}
        progressLabel={accessors.label(videoId)}
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
    <li class="download-item" role="listitem">
      <DownloadItem
        filename={accessors.filename(videoId)}
        oncancel={() => onCancel([videoId])}
        progress={accessors.progress(videoId)}
        progressLabel={accessors.label(videoId)}
      />
    </li>
  {/snippet}
</DownloadSection>

<style>
  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .section-title {
    color: var(--fg);
    font-weight: 500;
    font-size: 0.8125rem;
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
  }

  .zip-group-label {
    overflow: hidden;
    padding: 0 4px;
    color: var(--fg-subtle);
    font-size: 0.6875rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .download-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 0;
    list-style: none;
  }

  .download-item {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border: none;
    border-radius: 10px;
    background: var(--surface);
    transition: background-color 200ms;
  }

  .download-item--active {
    padding-left: 9px;
    border-left: 3px solid var(--accent);
  }
</style>
