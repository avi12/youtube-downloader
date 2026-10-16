<script lang="ts">
  import DownloadOptionsCard from "../download-options/DownloadOptionsCard.svelte";
  import downloadIcon from "../icons/download.svg?raw";
  import sparkleIcon from "../icons/sparkle.svg?raw";
  import { PANEL_LABELS, PopupPanel } from "../tabs";
  import ActiveDownloadsSections from "./ActiveDownloadsSections.svelte";
  import RecentDownloadsSection from "./recent/RecentDownloadsSection.svelte";
  import { startTabDownload } from "./watch-download";
  import { isActiveFromCurrentTab } from "./youtube-tab";
  import { resolveFFmpegCoreBuild } from "@/lib/download-pipeline/ffmpeg-core-build";
  import { FFmpegCoreBuild } from "@/lib/download-pipeline/mux-worker-types";
  import { deleteRecentDownload } from "@/lib/storage/recent-downloads-db";
  import { createLogger, LogScope } from "@/lib/utils/logger";
  import {
    getVideoIdFromUrl,
    isMobileWatchPageUrl,
    isMusicWatchPageUrl,
    isWatchPageUrl
  } from "@/lib/youtube/youtube-url";
  import { ProgressType } from "@/types";
  import type {
    DownloadProgressEntry,
    Options,
    RecentDownloadEntry,
    VideoDetail,
    VideoQueueItem
  } from "@/types";
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
    options: Options;
    onCancel: (videoIds: string[]) => void;
    onChangeFormat: (entry: RecentDownloadEntry) => void;
    onRecentChanged: () => void;
    onOpenSettings: () => void;
  }

  const {
    isFFmpegReady, videoDownloads, musicList, videoOnlyList, videoDetails,
    statusProgress, percentFormatter, recentDownloads, now,
    currentTabId, currentSourceUrl, pendingFormatChangeId, options,
    onCancel, onChangeFormat, onRecentChanged, onOpenSettings
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

  // Machines too slow for the SIMD FFmpeg build are the ones browsing the lighter mobile site
  const isMobileSiteSupported = resolveFFmpegCoreBuild() === FFmpegCoreBuild.NoSimd;
  const isPopupOnlyWatchTab = $derived(
    currentSourceUrl !== undefined
    && (isMusicWatchPageUrl(currentSourceUrl) || (isMobileSiteSupported && isMobileWatchPageUrl(currentSourceUrl)))
  );
  const watchVideoId = $derived(
    currentTabId !== undefined && currentSourceUrl !== undefined
      && (isPopupOnlyWatchTab || isWatchPageUrl(currentSourceUrl))
      ? getVideoIdFromUrl(currentSourceUrl)
      : null
  );
  const isWatchPageTab = $derived(watchVideoId !== null);
  const emptyStateText = $derived.by(() => {
    if (isPopupOnlyWatchTab) {
      return "Grab this video right here";
    }

    return isWatchPageTab
      ? "Grab this video right here, or hit this button under any video on YouTube"
      : "Start downloads right on YouTube - look for this button under any video";
  });
  const isWatchDownloadOffered = $derived(watchVideoId !== null && !allActiveIds.includes(watchVideoId));
  let isStartingWatchDownload = $state(false);
  let isOptionsOpen = $state(false);

  // Listing the video hides its buttons, so they come back enabled for another pick once it's done
  $effect(() => {
    const isWatchVideoListed = watchVideoId !== null && allActiveIds.includes(watchVideoId);
    if (isWatchVideoListed) {
      isStartingWatchDownload = false;
    }
  });

  function handleOptionsRequested(): void {
    isOptionsOpen = false;
    isStartingWatchDownload = true;
  }

  async function handleStartWatchDownload(): Promise<void> {
    if (currentTabId === undefined || currentSourceUrl === undefined || watchVideoId === null) {
      return;
    }

    isStartingWatchDownload = true;
    const isStarted = await startTabDownload({
      tabId: currentTabId,
      sourceUrl: currentSourceUrl,
      videoId: watchVideoId
    }).catch(error => {
      log.warn("Starting the download failed:", error);
      return false;
    });
    if (!isStarted) {
      isStartingWatchDownload = false;
    }
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

{#snippet chevronIcon()}
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
{/snippet}

{#snippet optionsToggle(className: string)}
  <button
    class={className}
    aria-controls="download-options-card"
    aria-expanded={isOptionsOpen}
    aria-label="Download options"
    disabled={isStartingWatchDownload}
    onclick={() => (isOptionsOpen = !isOptionsOpen)}
    type="button"
  >
    {@render chevronIcon()}
  </button>
{/snippet}

{#snippet optionsCard()}
  {#if isOptionsOpen && watchVideoId !== null && currentTabId !== undefined && currentSourceUrl !== undefined}
    <DownloadOptionsCard
      onRequested={handleOptionsRequested}
      {options}
      sourceUrl={currentSourceUrl}
      tabId={currentTabId}
      videoId={watchVideoId}
    />
  {/if}
{/snippet}

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
        {#if isWatchDownloadOffered}
          {@render optionsToggle("youtube-download-pill-chevron youtube-download-pill-toggle")}
        {:else}
          <span class="youtube-download-pill-chevron" aria-hidden="true">
            {@render chevronIcon()}
          </span>
        {/if}
      </span>
    </div>
    {@render optionsCard()}
    <div class="empty-state-hint">
      {@html sparkleIcon}
      <span>
        Tip: pick formats, quality &amp; languages in
        <button
          class="text-link"
          onclick={onOpenSettings}
          type="button"
        >
          {PANEL_LABELS[PopupPanel.Settings]}
        </button>
      </span>
    </div>
  </section>
{:else}
  <div class="download-sections">
    {#if isWatchDownloadOffered}
      <div class="watch-download">
        <button
          class="watch-download-button"
          disabled={isStartingWatchDownload}
          onclick={handleStartWatchDownload}
          type="button"
        >
          {@html downloadIcon}
          Download this video
        </button>
        {@render optionsToggle("watch-download-toggle")}
      </div>
      {@render optionsCard()}
    {/if}
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

    .youtube-download-pill-button,
    .youtube-download-pill-toggle {
      align-self: stretch;
      border: none;
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

    .youtube-download-pill-button {
      border-end-start-radius: 999px;
      border-start-start-radius: 999px;
    }

    .youtube-download-pill-chevron {
      display: inline-flex;
      align-items: center;
      height: 20px;
      padding-inline: 6px 8px;
      border-inline-start: 1px solid color-mix(in oklab, var(--fg) 25%, transparent);
    }

    .youtube-download-pill-toggle {
      height: auto;
      border-end-end-radius: 999px;
      border-start-end-radius: 999px;
    }

    :global(#download-options-card) {
      align-self: stretch;
      text-align: start;
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

  .watch-download {
    display: flex;
  }

  .watch-download-button,
  .watch-download-toggle {
    display: flex;
    justify-content: center;
    align-items: center;
    border: none;
    background: var(--accent-container);
    color: var(--fg);
    font: inherit;
    font-weight: 600;
    font-size: 0.8125rem;
    cursor: pointer;
    transition: background-color 200ms;

    :global(svg) {
      width: 18px;
      height: 18px;
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    &:disabled {
      opacity: 60%;
      cursor: progress;
    }

    &:hover:enabled {
      background: color-mix(in oklab, var(--accent) 28%, var(--accent-container));
    }
  }

  .watch-download-button {
    flex: 1;
    gap: 8px;
    padding: 10px 14px;
    border-end-start-radius: 999px;
    border-start-start-radius: 999px;
  }

  .watch-download-toggle {
    padding-inline: 10px 14px;
    border-inline-start: 1px solid color-mix(in oklab, var(--fg) 25%, transparent);
    border-end-end-radius: 999px;
    border-start-end-radius: 999px;
  }

  .youtube-download-pill-toggle,
  .watch-download-toggle {
    :global(svg) {
      transition: rotate 200ms cubic-bezier(0.2, 0, 0, 1);
    }

    &[aria-expanded="true"] :global(svg) {
      rotate: 180deg;
    }
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
