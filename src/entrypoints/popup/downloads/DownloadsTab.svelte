<script lang="ts">
  import downloadIcon from "../icons/download.svg?raw";
  import RecentDownloadsSection from "../recent/RecentDownloadsSection.svelte";
  import ActiveDownloadsSections from "./ActiveDownloadsSections.svelte";
  import { deleteRecentDownload } from "@/lib/storage/recent-downloads-db";
  import type { DownloadProgressEntry, RecentDownloadEntry, VideoQueueItem } from "@/types";
  import { browser } from "#imports";

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
    <p class="empty-state-text">Anything you grab shows up here. Open a video, channel, or playlist and tap the toolbar button to start</p>
    <div class="empty-state-hint">
      <svg aria-hidden="true" fill="currentColor" height="14" viewBox="0 -960 960 960" width="14" xmlns="http://www.w3.org/2000/svg">
        <path d="M480-120q-16 0-28-10t-15-26l-13-98q-27-9-50.5-24T329-313l-93 41q-15 7-30 2t-23-19l-40-68q-8-14-5-30t15-25l80-59q-2-13-3-26.5t-1-27.5q0-14 1-27.5t3-26.5l-80-59q-12-9-15-25t5-30l40-68q8-14 23-19t30 2l93 41q21-17 44.5-32T425-806l13-98q3-16 15-26t28-10q16 0 28 10t15 26l13 98q27 9 50.5 24T631-747l93-41q15-7 30-2t23 19l40 68q8 14 5 30t-15 25l-80 59q2 13 3 26.5t1 27.5q0 14-1 27.5T727-508l80 59q12 9 15 25t-5 30l-40 68q-8 14-23 19t-30-2l-93-41q-21 17-44.5 32T535-294l-13 98q-3 16-15 26t-28 10Zm0-320q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Z" />
      </svg>
      Tip: pick formats, quality &amp; languages in Settings
    </div>
  </section>
{:else}
  <div class="download-sections">
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
    }
  }

  .download-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
