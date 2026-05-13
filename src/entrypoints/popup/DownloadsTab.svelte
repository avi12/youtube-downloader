<script lang="ts">
  import ActiveDownloadsSections from "./ActiveDownloadsSections.svelte";
  import downloadIcon from "./icons/download.svg?raw";
  import RecentDownloadItem from "./RecentDownloadItem.svelte";
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
    }>;
    statusProgress: Record<string, {
      progress: number;
      progressType: ProgressType;
    }>;
    percentFormatter: Intl.NumberFormat;
    recentDownloads: RecentDownloadEntry[];
    now: number;
    onChangeFormat: (entry: RecentDownloadEntry) => void;
    onRecentChanged: () => void;
  }

  const {
    isFFmpegReady,
    videoDownloads,
    musicList,
    videoOnlyList,
    videoDetails,
    statusProgress,
    percentFormatter,
    recentDownloads,
    now,
    onChangeFormat,
    onRecentChanged
  }: Props = $props();

  const totalActiveDownloads = $derived(videoDownloads.length + musicList.length + videoOnlyList.length);
  const isAnyContentAvailable = $derived(totalActiveDownloads > 0 || recentDownloads.length > 0);

  function handleShowInFolder(entry: RecentDownloadEntry) {
    try {
      browser.downloads.show(entry.downloadId);
    } catch (error) {
      console.warn("[ytdl:popup] Show in folder failed:", error);
    }
  }

  async function handleRemove(entry: RecentDownloadEntry) {
    await deleteRecentDownload(entry.id);
    onRecentChanged();
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
                onRemove={() => handleRemove(entry)}
                onShowInFolder={() => handleShowInFolder(entry)}
              />
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
{/if}
