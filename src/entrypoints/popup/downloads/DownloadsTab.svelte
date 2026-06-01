<script lang="ts">
  import downloadIcon from "../icons/download.svg?raw";
  import sparkleIcon from "../icons/sparkle.svg?raw";
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
      {@html sparkleIcon}
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
    gap: 16px;
  }
</style>
