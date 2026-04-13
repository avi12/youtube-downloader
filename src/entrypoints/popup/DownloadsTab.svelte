<script lang="ts">
  import DownloadItem from "./DownloadItem.svelte";
  import DownloadSection from "./DownloadSection.svelte";
  import downloadIcon from "./icons/download.svg?raw";
  import RecentDownloadItem from "./RecentDownloadItem.svelte";
  import { MessageType, sendMessage } from "@/lib/messaging";
  import { deleteRecentDownload } from "@/lib/recent-downloads-db";
  import { ProgressType } from "@/types";
  import type { RecentDownloadEntry, VideoQueueItem } from "@/types";
  import { browser } from "#imports";

  type ProgressEntry = {
    progress: number;
    progressType: ProgressType;
  };

  type Props = {
    isFFmpegReady: boolean;
    videoDownloads: VideoQueueItem[];
    musicList: string[];
    videoOnlyList: string[];
    videoDetails: Record<string, { filenameOutput: string }>;
    statusProgress: Record<string, ProgressEntry>;
    percentFormatter: Intl.NumberFormat;
    recentDownloads: RecentDownloadEntry[];
    now: number;
    onChangeFormat: (entry: RecentDownloadEntry) => void;
    onRecentChanged: () => void;
  };

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
  const hasAnyContent = $derived(totalActiveDownloads > 0 || recentDownloads.length > 0);

  async function handleShowInFolder(entry: RecentDownloadEntry) {
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

  const videoDownloadIds = $derived(videoDownloads.map(item => item.videoId));

  function cancelDownload(videoIds: string[]) {
    void sendMessage(MessageType.CancelDownload, { videoIds });
  }

  function getProgressLabel(videoId: string) {
    const prog = statusProgress[videoId];
    if (!prog) {
      return "";
    }

    const percentage = percentFormatter.format(prog.progress);
    if (prog.progressType === ProgressType.FFmpeg) {
      return `${percentage} stitching`;
    }

    return `${percentage} (${prog.progressType})`;
  }

  function getProgress(videoId: string) {
    return statusProgress[videoId]?.progress ?? null;
  }

  function getFilename(videoId: string) {
    return videoDetails[videoId]?.filenameOutput ?? videoId;
  }

  function getVideoStatusLabel(index: number) {
    if (index === 0) {
      return isFFmpegReady ? "Processing…" : "Waiting for FFmpeg…";
    }

    return "Downloading";
  }
</script>

{#if !hasAnyContent}
  <div class="empty-state">
    <span class="empty-state-icon">{@html downloadIcon}</span>
    <p class="empty-state-text">No downloads yet</p>
    <p class="empty-state-hint">Downloads appear here when you start one from YouTube</p>
  </div>
{:else}
  <div class="download-sections">
    {#if totalActiveDownloads > 0}
      <DownloadSection
        cancelAriaLabel="Cancel all video downloads"
        listAriaLabel="Active video downloads"
        loadingBadge={!isFFmpegReady ? "Loading FFmpeg…" : undefined}
        onCancelAll={() => cancelDownload(videoDownloadIds)}
        sectionId="video-downloads"
        title="Video downloads"
        videoIds={videoDownloadIds}
      >
        {#snippet renderItem(videoId, index)}
          <li
            class="download-item"
            aria-label={getFilename(videoId)}
            role="listitem"
          >
            <DownloadItem
              filename={getFilename(videoId)}
              oncancel={() => cancelDownload([videoId])}
              progress={getProgress(videoId)}
              progressLabel={getProgressLabel(videoId)}
              statusLabel={getProgress(videoId) === null ? getVideoStatusLabel(index) : null}
            />
          </li>
        {/snippet}
      </DownloadSection>

      <DownloadSection
        cancelAriaLabel="Cancel all audio downloads"
        listAriaLabel="Audio downloads"
        onCancelAll={() => cancelDownload(musicList)}
        sectionId="music-list"
        title="Audio"
        videoIds={musicList}
      >
        {#snippet renderItem(videoId)}
          <li class="download-item" role="listitem">
            <DownloadItem
              filename={getFilename(videoId)}
              oncancel={() => cancelDownload([videoId])}
              progress={getProgress(videoId)}
              progressLabel={getProgressLabel(videoId)}
            />
          </li>
        {/snippet}
      </DownloadSection>

      <DownloadSection
        cancelAriaLabel="Cancel all video-only downloads"
        listAriaLabel="Video-only downloads"
        onCancelAll={() => cancelDownload(videoOnlyList)}
        sectionId="video-only"
        title="Video only"
        videoIds={videoOnlyList}
      >
        {#snippet renderItem(videoId)}
          <li class="download-item" role="listitem">
            <DownloadItem
              filename={getFilename(videoId)}
              oncancel={() => cancelDownload([videoId])}
              progress={getProgress(videoId)}
              progressLabel={getProgressLabel(videoId)}
            />
          </li>
        {/snippet}
      </DownloadSection>
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

  .download-item {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border: none;
    border-radius: 16px;
    background: var(--surface);
    transition: background-color 200ms;
  }

  .recent-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .recent-section-heading {
    margin: 0;
    padding: 0 4px;
    color: var(--fg-muted);
    font-weight: 500;
    font-size: 0.8125rem;
  }

  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
