<script lang="ts">
  import downloadIcon from "../icons/download.svg?raw";
  import RecentDownloadsSection from "../recent/RecentDownloadsSection.svelte";
  import ActiveDownloadsSections from "./ActiveDownloadsSections.svelte";
  import { MessageType, sendMessage } from "@/lib/messaging/messaging";
  import { deleteRecentDownload } from "@/lib/storage/recent-downloads-db";
  import { ProgressType } from "@/types";
  import type { RecentDownloadEntry, VideoQueueItem } from "@/types";
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
    }>;
    statusProgress: Record<string, {
      progress: number;
      progressType: ProgressType;
    }>;
    percentFormatter: Intl.NumberFormat;
    recentDownloads: RecentDownloadEntry[];
    now: number;
    currentTabId?: number;
    onChangeFormat: (entry: RecentDownloadEntry) => void;
    onRecentChanged: () => void;
  }

  const {
    isFFmpegReady, videoDownloads, musicList, videoOnlyList, videoDetails,
    statusProgress, percentFormatter, recentDownloads, now, currentTabId, onChangeFormat, onRecentChanged
  }: Props = $props();

  const totalActiveDownloads = $derived(videoDownloads.length + musicList.length + videoOnlyList.length);
  const isAnyContentAvailable = $derived(totalActiveDownloads > 0 || recentDownloads.length > 0);

  async function handleRemove(entry: RecentDownloadEntry) {
    await deleteRecentDownload(entry.id);
    onRecentChanged();
  }

  function handleShowInFolder(entry: RecentDownloadEntry) {
    try {
      browser.downloads.show(entry.downloadId);
    } catch (error) {
      console.warn("[ytdl:popup] Show in folder failed:", error);
    }
  }

  function cancelDownload(videoIds: string[]) {
    void sendMessage(MessageType.CancelDownload, { videoIds });
  }
</script>

{#if !isAnyContentAvailable}
  <div class="empty-state">
    <span class="empty-state-icon">{@html downloadIcon}</span>
    <p class="empty-state-text">No downloads yet</p>
    <p class="empty-state-hint">Downloads appear here when you start one from YouTube</p>
  </div>
{:else}
  <div class="download-sections">
    {#if totalActiveDownloads > 0}
      <ActiveDownloadsSections
        {currentTabId}
        {isFFmpegReady}
        {musicList}
        onCancel={cancelDownload}
        {percentFormatter}
        {statusProgress}
        {videoDetails}
        {videoDownloads}
        {videoOnlyList}
      />
    {/if}
    <RecentDownloadsSection
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
    gap: 8px;
    align-items: center;
    padding: 32px 0;
    text-align: center;
  }

  .empty-state-icon {
    display: contents;
    color: var(--border);
  }

  .empty-state-text {
    color: var(--fg-muted);
    font-weight: 500;
    font-size: 0.875rem;
  }

  .empty-state-hint {
    color: var(--fg-subtle);
    font-size: 0.75rem;
  }

  .download-sections {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
</style>
