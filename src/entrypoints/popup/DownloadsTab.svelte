<script lang="ts">
  import DownloadItem from "./DownloadItem.svelte";
  import { MessageType, sendMessage } from "@/lib/messaging";
  import { videoQueueItem } from "@/lib/storage";
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

  const totalActiveDownloads = $derived(
    videoDownloads.length + musicList.length + videoOnlyList.length
  );

  // --- Actions ---------------------------------------------------------------

  function cancelDownload(videoIds: string[]) {
    void sendMessage(MessageType.CancelDownload, { videoIds });
  }

  function cancelAllVideo() {
    const allIds = videoDownloads.map(item => item.videoId);
    if (allIds.length > 0) {
      cancelDownload(allIds);
    }
  }

  function cancelAllMusic() {
    if (musicList.length > 0) {
      cancelDownload(musicList);
    }
  }

  function cancelAllVideoOnly() {
    if (videoOnlyList.length > 0) {
      cancelDownload(videoOnlyList);
    }
  }

  // --- Drag-and-drop ---------------------------------------------------------

  let draggedVideoId = $state<string | null>(null);
  let dragOverVideoId = $state<string | null>(null);

  async function handleDrop() {
    if (!draggedVideoId || !dragOverVideoId || draggedVideoId === dragOverVideoId) {
      return;
    }

    const fromIndex = videoDownloads.findIndex(item => item.videoId === draggedVideoId);
    const toIndex = videoDownloads.findIndex(item => item.videoId === dragOverVideoId);
    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const reordered = [...videoDownloads];
    const [removed] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, removed);

    await videoQueueItem.setValue(reordered);

    draggedVideoId = null;
    dragOverVideoId = null;
  }

  // --- Helpers ---------------------------------------------------------------

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

  function getVideoStatusLabel(videoId: string, index: number) {
    if (getProgress(videoId) !== null) {
      return undefined;
    }

    if (index === 0) {
      return isFFmpegReady ? "Processing…" : "Waiting for FFmpeg…";
    }

    return "Downloading";
  }
</script>

{#if totalActiveDownloads === 0}
  <p class="empty-state">No active downloads</p>
{:else}
  {#if videoDownloads.length > 0}
    <section aria-labelledby="video-downloads-heading">
      <div class="section-header">
        <h2 id="video-downloads-heading" class="section-title">
          Video downloads
          {#if !isFFmpegReady}
            <span class="loading-badge" aria-label="FFmpeg loading">Loading FFmpeg…</span>
          {/if}
        </h2>
        <button
          class="cancel-all-button"
          aria-label="Cancel all video downloads"
          onclick={cancelAllVideo}
        >
          Cancel all
        </button>
      </div>

      <ul class="download-list" aria-label="Active video downloads" role="list">
        {#each videoDownloads as item, index (item.videoId)}
          <li
            class="download-item"
            class:download-item--current={index === 0}
            class:download-item--drag-over={dragOverVideoId === item.videoId}
            aria-label={getFilename(item.videoId)}
            draggable="true"
            ondragover={e => {
              e.preventDefault();
              dragOverVideoId = item.videoId;
            }}
            ondragstart={() => (draggedVideoId = item.videoId)}
            ondrop={handleDrop}
            role="listitem"
          >
            <span class="queue-position" aria-hidden="true">{index + 1}</span>
            <DownloadItem
              filename={getFilename(item.videoId)}
              oncancel={() => cancelDownload([item.videoId])}
              progress={getProgress(item.videoId)}
              progressLabel={getProgressLabel(item.videoId)}
              statusLabel={getVideoStatusLabel(item.videoId, index)}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if musicList.length > 0}
    <section aria-labelledby="music-list-heading">
      <div class="section-header">
        <h2 id="music-list-heading" class="section-title">Audio</h2>
        <button
          class="cancel-all-button"
          aria-label="Cancel all audio downloads"
          onclick={cancelAllMusic}
        >
          Cancel all
        </button>
      </div>

      <ul class="download-list" aria-label="Audio downloads" role="list">
        {#each musicList as videoId (videoId)}
          <li class="download-item" role="listitem">
            <DownloadItem
              filename={getFilename(videoId)}
              oncancel={() => cancelDownload([videoId])}
              progress={getProgress(videoId)}
              progressLabel={getProgressLabel(videoId)}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if videoOnlyList.length > 0}
    <section aria-labelledby="video-only-heading">
      <div class="section-header">
        <h2 id="video-only-heading" class="section-title">Video only</h2>
        <button
          class="cancel-all-button"
          aria-label="Cancel all video-only downloads"
          onclick={cancelAllVideoOnly}
        >
          Cancel all
        </button>
      </div>

      <ul class="download-list" aria-label="Video-only downloads" role="list">
        {#each videoOnlyList as videoId (videoId)}
          <li class="download-item" role="listitem">
            <DownloadItem
              filename={getFilename(videoId)}
              oncancel={() => cancelDownload([videoId])}
              progress={getProgress(videoId)}
              progressLabel={getProgressLabel(videoId)}
            />
          </li>
        {/each}
      </ul>
    </section>
  {/if}
{/if}

<style>
  .empty-state {
    padding: 32px 0;
    color: var(--fg-subtle);
    font-size: 0.8125rem;
    text-align: center;
  }

  section + section {
    margin-top: 16px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .section-title {
    display: flex;
    gap: 8px;
    align-items: center;
    color: var(--fg);
    font-weight: 500;
    font-size: 0.8125rem;
  }

  .loading-badge {
    color: var(--fg-subtle);
    font-weight: 400;
    font-size: 0.6875rem;
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
    border-radius: 16px;
    background: var(--surface);
    transition: background-color 200ms;
  }

  .download-item--current {
    background: var(--accent-container);
  }

  .download-item--drag-over {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }

  .download-item[draggable="true"] {
    cursor: grab;

    &:active {
      cursor: grabbing;
    }
  }

  .queue-position {
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    width: 24px;
    height: 24px;
    border-radius: 12px;
    background: var(--surface-high);
    color: var(--fg-muted);
    font-weight: 600;
    font-size: 0.6875rem;
  }
</style>
