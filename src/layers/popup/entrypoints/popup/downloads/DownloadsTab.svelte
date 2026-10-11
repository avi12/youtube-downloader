<script lang="ts">
  import downloadIcon from "../icons/download.svg?raw";
  import sparkleIcon from "../icons/sparkle.svg?raw";
  import ActiveDownloadsSections from "./ActiveDownloadsSections.svelte";
  import RecentDownloadsSection from "./recent/RecentDownloadsSection.svelte";
  import { isActiveFromCurrentTab } from "./youtube-tab";
  import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
  import { deleteRecentDownload } from "@/lib/storage/recent-downloads-db";
  import { createLogger, LogScope } from "@/lib/utils/logger";
  import { isWatchPageUrl } from "@/lib/youtube/youtube-url";
  import { ProgressType } from "@/types";
  import type { DownloadProgressEntry, RecentDownloadEntry, VideoDetail, VideoQueueItem } from "@/types";
  import { browser } from "#imports";

  const log = createLogger(LogScope.Popup);

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
    pendingFormatChangeId: string | null;
    onCancel: (videoIds: string[]) => void;
    onChangeFormat: (entry: RecentDownloadEntry) => void;
    onRecentChanged: () => void;
  }

  const {
    isFFmpegReady, videoDownloads, musicList, videoOnlyList, videoDetails,
    statusProgress, percentFormatter, recentDownloads, now,
    currentTabId, currentSourceUrl, pendingFormatChangeId,
    onCancel, onChangeFormat, onRecentChanged
  }: Props = $props();

  const totalActiveDownloads = $derived(videoDownloads.length + musicList.length + videoOnlyList.length);
  const isAnyContentAvailable = $derived(totalActiveDownloads > 0 || recentDownloads.length > 0);

  const allActiveIds = $derived([
    ...videoDownloads.map(item => item.videoId),
    ...musicList,
    ...videoOnlyList
  ]);

  const currentTabActiveIds = $derived(
    allActiveIds.filter(videoId => isActiveFromCurrentTab({
      videoId,
      detail: videoDetails[videoId]
    }, {
      currentTabId,
      currentSourceUrl
    }))
  );
  const hasCurrentTabDownloads = $derived(currentTabActiveIds.length > 0);
  const hasOtherTabDownloads = $derived(currentTabActiveIds.length < allActiveIds.length);

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

  const isWatchPageTab = $derived(
    currentTabId !== undefined && currentSourceUrl !== undefined && isWatchPageUrl(currentSourceUrl)
  );
  const emptyStateText = $derived(
    isWatchPageTab
      ? "Grab this video right here, or hit this button under any video on YouTube"
      : "Start downloads right on YouTube - look for this button under any video"
  );
  let isStartingWatchDownload = $state(false);

  async function handleStartWatchDownload(): Promise<void> {
    if (currentTabId === undefined) {
      return;
    }

    isStartingWatchDownload = true;
    const isStarted = await sendMessageToTab(MessageType.StartWatchPageDownload, undefined, currentTabId)
      .catch(error => {
        log.warn("Starting the watch page download failed:", error);
        return false;
      });
    isStartingWatchDownload = Boolean(isStarted);
  }

  async function handleRemove(entry: RecentDownloadEntry): Promise<void> {
    await deleteRecentDownload(entry.id);
    onRecentChanged();
  }

  function handleShowInFolder(entry: RecentDownloadEntry): void {
    try {
      browser.downloads.show(entry.downloadId);
    } catch (error) {
      log.warn("Show in folder failed:", error);
    }
  }
</script>

{#if !isAnyContentAvailable}
  <section class="empty-state">
    <div class="empty-state-icon-box">
      {@html downloadIcon}
    </div>
    <h3 class="empty-state-heading">No downloads yet</h3>
    <p class="empty-state-text">{emptyStateText}</p>
    <div class="youtube-actions-preview" aria-hidden={isWatchPageTab ? undefined : "true"}>
      <span class="youtube-action-pill" aria-hidden="true">Like</span>
      <span class="youtube-action-pill" aria-hidden="true">Share</span>
      <span class="youtube-action-pill youtube-download-pill">
        {#if isWatchPageTab}
          <button
            class="youtube-download-pill-main youtube-download-pill-button"
            aria-label="Download this video"
            disabled={isStartingWatchDownload}
            onclick={handleStartWatchDownload}
            type="button"
          >
            {@html downloadIcon}
            Download
          </button>
        {:else}
          <span class="youtube-download-pill-main">
            {@html downloadIcon}
            Download
          </span>
        {/if}
        <span class="youtube-download-pill-chevron" aria-hidden="true">
          <svg
            fill="none"
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </span>
    </div>
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
      {onChangeFormat}
      onRemoveRecent={handleRemove}
      onShowRecentInFolder={handleShowInFolder}
      {pendingFormatChangeId}
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
      {onChangeFormat}
      onRemove={handleRemove}
      onShowInFolder={handleShowInFolder}
      {pendingFormatChangeId}
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
    padding-top: 16px;
    padding-bottom: 16px;
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

    .youtube-actions-preview {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 12px 14px;
      border-radius: 16px;
      background: var(--surface);
      font-weight: 500;
      font-size: 0.8125rem;
    }

    .youtube-action-pill {
      display: inline-flex;
      align-items: center;
      height: 32px;
      padding-inline: 14px;
      border-radius: 999px;
      background: color-mix(in oklab, var(--fg) 8%, transparent);
      color: var(--fg-muted);
    }

    .youtube-download-pill {
      padding-inline: 0;
      background: var(--accent-container);
      color: var(--fg);
      outline: 2px solid var(--accent);
      outline-offset: 2px;

      :global(svg) {
        width: 18px;
        height: 18px;
      }
    }

    .youtube-download-pill-main {
      display: inline-flex;
      gap: 6px;
      align-items: center;
      padding-inline: 12px 10px;
    }

    .youtube-download-pill-button {
      align-self: stretch;
      border: none;
      border-end-start-radius: 999px;
      border-start-start-radius: 999px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
      transition: background-color 200ms;

      &:hover:enabled {
        background: color-mix(in oklab, var(--accent) 18%, transparent);
      }

      &:active:enabled {
        background: color-mix(in oklab, var(--accent) 28%, transparent);
      }

      &:focus-visible {
        outline: 2px solid var(--fg);
        outline-offset: -2px;
      }

      &:disabled {
        opacity: 60%;
        cursor: progress;
      }
    }

    .youtube-download-pill-chevron {
      display: inline-flex;
      align-items: center;
      height: 20px;
      padding-inline: 6px 8px;
      border-inline-start: 1px solid color-mix(in oklab, var(--fg) 25%, transparent);
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
