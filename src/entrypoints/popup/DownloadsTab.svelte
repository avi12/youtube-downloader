<script lang="ts">
  import DownloadItem from "./DownloadItem.svelte";
  import DownloadSection from "./DownloadSection.svelte";
  import { MessageType, sendMessage } from "@/lib/messaging";
  import { ProgressType } from "@/types";
  import type { VideoQueueItem } from "@/types";

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
  };

  const {
    isFFmpegReady,
    videoDownloads,
    musicList,
    videoOnlyList,
    videoDetails,
    statusProgress,
    percentFormatter
  }: Props = $props();

  const totalActiveDownloads = $derived(videoDownloads.length + musicList.length + videoOnlyList.length);

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

{#if totalActiveDownloads === 0}
  <div class="empty-state">
    <svg
      class="empty-state-icon"
      aria-hidden="true"
      fill="currentColor"
      height="48"
      viewBox="0 0 24 24"
      width="48"
    >
      <path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" />
    </svg>
    <p class="empty-state-text">No active downloads</p>
    <p class="empty-state-hint">Downloads appear here when you start one from YouTube</p>
  </div>
{:else}
  <div class="download-sections">
  <DownloadSection
    cancelAriaLabel="Cancel all video downloads"
    listAriaLabel="Active video downloads"
    loadingBadge={!isFFmpegReady ? "Loading FFmpeg…" : undefined}
    onCancelAll={() => cancelDownload(videoDownloadIds)}
    sectionId="video-downloads"
    title="Video downloads"
    videoIds={videoDownloadIds}
  >
    {#snippet renderItem(videoId: string, index: number)}
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
    {#snippet renderItem(videoId: string)}
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
    {#snippet renderItem(videoId: string)}
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
</style>
