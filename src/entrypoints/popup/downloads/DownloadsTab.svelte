<script lang="ts">
  import downloadIcon from "../icons/download.svg?raw";
  import sparkleIcon from "../icons/sparkle.svg?raw";
  import ActiveDownloadsSections from "./ActiveDownloadsSections.svelte";
  import RecentDownloadsSection from "./recent/RecentDownloadsSection.svelte";
  import { deleteRecentDownload } from "@/lib/storage/recent-downloads-db";
  import { ProgressType } from "@/types";
  import type { DownloadProgressEntry, RecentDownloadEntry, VideoDetail, VideoQueueItem } from "@/types";
  import { browser } from "#imports";

  interface Props {
    isFFmpegReady: boolean;
    videoDownloads: VideoQueueItem[];
    musicList: string[];
    videoOnlyList: string[];
    videoDetails: Record<string, VideoDetail>;
    statusProgress: Record<string, DownloadProgressEntry>;
    percentFormatter: Intl.NumberFormat;
    recentDownloads: RecentDownloadEntry[];
    now: number;
    currentTabId?: number;
    currentSourceUrl?: string;
    onCancel: (videoIds: string[]) => void;
    onChangeFormat: (entry: RecentDownloadEntry) => void;
    onRecentChanged: () => void;
  }

  const {
    isFFmpegReady, videoDownloads, musicList, videoOnlyList, videoDetails,
    statusProgress, percentFormatter, recentDownloads, now,
    currentTabId, currentSourceUrl, onCancel, onChangeFormat, onRecentChanged
  }: Props = $props();

  const totalActiveDownloads = $derived(videoDownloads.length + musicList.length + videoOnlyList.length);
  const isAnyContentAvailable = $derived(totalActiveDownloads > 0 || recentDownloads.length > 0);

  const allActiveIds = $derived([
    ...videoDownloads.map(item => item.videoId),
    ...musicList,
    ...videoOnlyList
  ]);

  const hasCurrentTabDownloads = $derived(
    currentTabId !== undefined && Boolean(currentSourceUrl)
    && allActiveIds.some(id => {
      const detail = videoDetails[id];
      return detail?.tabId === currentTabId && detail?.sourceUrl === currentSourceUrl;
    })
  );

  const hasOtherTabDownloads = $derived(
    allActiveIds.some(id => {
      const detail = videoDetails[id];
      if (!detail) {
        return true;
      }

      if (!currentTabId || !currentSourceUrl) {
        return true;
      }

      return !(detail.tabId === currentTabId && detail.sourceUrl === currentSourceUrl);
    })
  );

  const bannerScope = $derived.by(() => {
    if (hasCurrentTabDownloads && hasOtherTabDownloads) {
      return "Across this tab and others";
    }

    if (hasCurrentTabDownloads) {
      return "On this tab";
    }

    return "On other tabs";
  });

  const processingCount = $derived(
    allActiveIds.filter(id => statusProgress[id]?.progressType === ProgressType.FFmpeg).length
  );
  const downloadingCount = $derived(totalActiveDownloads - processingCount);

  const bannerCountText = $derived.by(() => {
    const parts: string[] = [];
    if (downloadingCount > 0) {
      parts.push(`${downloadingCount} downloading`);
    }

    if (processingCount > 0) {
      parts.push(`${processingCount} processing`);
    }

    return parts.join(" · ");
  });

  async function handleRemove(entry: RecentDownloadEntry): Promise<void> {
    await deleteRecentDownload(entry.id);
    onRecentChanged();
  }

  function handleShowInFolder(entry: RecentDownloadEntry): void {
    try {
      browser.downloads.show(entry.downloadId);
    } catch (error) {
      console.warn("[ytdl:popup] Show in folder failed:", error);
    }
  }
</script>

{#if !isAnyContentAvailable}
  <section class="empty-state">
    <div class="empty-state-icon-box">
      {@html downloadIcon}
    </div>
    <h3 class="empty-state-heading">No downloads yet</h3>
    <p class="empty-state-text">
      Anything you grab shows up here. Open a video, channel, or playlist and tap the toolbar button to start
    </p>
    <div class="empty-state-hint">
      {@html sparkleIcon}
      Tip: pick formats, quality &amp; languages in Settings
    </div>
  </section>
{:else}
  <div class="download-sections">
    {#if totalActiveDownloads > 0}
      <div class="dl-banner" role="status">
        <span class="dl-banner-spinner" aria-hidden="true"></span>
        <span class="dl-banner-body">
          <span class="dl-banner-count">{bannerCountText}</span>
          <span class="dl-banner-scope">{bannerScope}</span>
        </span>
        <button
          class="dl-banner-cancel"
          onclick={() => onCancel(allActiveIds)}
          type="button"
        >
          Cancel all
        </button>
      </div>
    {/if}
    <ActiveDownloadsSections
      {currentSourceUrl}
      {currentTabId}
      {isFFmpegReady}
      {musicList}
      {now}
      {onCancel}
      onChangeFormat={entry => onChangeFormat(entry)}
      onRemoveRecent={handleRemove}
      onShowRecentInFolder={handleShowInFolder}
      {percentFormatter}
      {recentDownloads}
      {statusProgress}
      {videoDetails}
      {videoDownloads}
      {videoOnlyList}
    />
    <RecentDownloadsSection
      {currentSourceUrl}
      {currentTabId}
      {now}
      onChangeFormat={entry => onChangeFormat(entry)}
      onRemove={handleRemove}
      onShowInFolder={handleShowInFolder}
      {recentDownloads}
    />
  </div>
{/if}

<style>
  .empty-state {
    display: flex;
    flex-direction: column;
    gap: 12px;
    align-items: center;
    padding-top: 40px;
    padding-bottom: 32px;
    padding-inline: 16px;
    text-align: center;

    .empty-state-icon-box {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 84px;
      height: 84px;
      border-radius: 28px;
      background: var(--accent-container);
      color: var(--accent);

      :global(svg) {
        width: 40px;
        height: 40px;
      }
    }

    .empty-state-heading {
      margin: 0;
      color: var(--fg);
      font-weight: 600;
      font-size: 1rem;
    }

    .empty-state-text {
      max-width: 280px;
      color: var(--fg-muted);
      font-size: 0.8125rem;
      line-height: 1.5;
    }

    .empty-state-hint {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      padding: 6px 14px;
      border-radius: 999px;
      background: var(--surface);
      color: var(--fg-muted);
      font-size: 0.75rem;

      :global(svg) {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        color: var(--accent);
      }
    }
  }

  .download-sections {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .dl-banner {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 10px 14px;
    border-radius: 999px;
    background: var(--accent-container);
    color: var(--fg);

    .dl-banner-spinner {
      flex-shrink: 0;
      width: 16px;
      height: 16px;
      border: 2px solid color-mix(in oklab, var(--accent) 30%, transparent);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 700ms linear infinite;
    }

    .dl-banner-body {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 1px;
      min-width: 0;

      .dl-banner-count {
        font-weight: 600;
        font-size: 0.8125rem;
      }

      .dl-banner-scope {
        color: var(--fg-muted);
        font-size: 0.6875rem;
      }
    }

    .dl-banner-cancel {
      flex-shrink: 0;
      padding: 5px 14px;
      border: none;
      border-radius: 20px;
      background: transparent;
      color: var(--fg);
      font-family: inherit;
      font-weight: 600;
      font-size: 0.75rem;
      cursor: pointer;
      transition: background-color 200ms;

      &:hover {
        background: color-mix(in oklab, var(--accent) 18%, transparent);
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }
    }
  }

  @keyframes spin {
    to {
      rotate: 360deg;
    }
  }
</style>
