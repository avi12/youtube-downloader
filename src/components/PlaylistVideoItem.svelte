<script lang="ts">
  /**
   * Download controls for a single video within a playlist.
   * Injected into ytd-playlist-video-renderer elements.
   */
  import { sendMessage } from "../lib/messaging";
  import { pageMessenger } from "../lib/page-messenger";
  import { videoQueueItem } from "../lib/storage";
  import { getCompatibleFilename } from "../lib/utils";
  import type { Options, VideoData } from "../types";

  type Props = {
    videoId: string;
    options: Options;
  };

  const { videoId, options }: Props = $props();

  let videoData = $state<VideoData | null>(null);
  let isDownloading = $state(false);
  let isDone = $state(false);
  let isQueued = $state(false);
  let progress = $state(0);

  // Request video data from MAIN world and track when it arrives
  $effect(() => {
    const unsubscribe = pageMessenger.onMessage("videoData", ({ data }) => {
      if (data.videoId === videoId) {
        videoData = data;
      }
    });
    void pageMessenger.sendMessage("requestVideoData", { videoId });
    return unsubscribe;
  });

  // Track progress updates
  $effect(() => pageMessenger.onMessage("progress", ({ data }) => {
    if (data.videoId !== videoId) {
      return;
    }

    if (data.isRemoved) {
      progress = 0;
      isDownloading = false;
      isDone = false;
      isQueued = false;
      return;
    }

    progress = data.progress;
    isDone = data.progress >= 1;
  }));

  // Track queue position
  function handleQueueChange(queue: { videoId: string }[] | null) {
    const currentQueue = queue ?? [];
    const isInQueue = currentQueue.some(item => item.videoId === videoId);
    const isCurrentlyDownloading = currentQueue[0]?.videoId === videoId;
    isQueued = isInQueue && !isCurrentlyDownloading;
  }

  $effect(() => videoQueueItem.watch(handleQueueChange));

  const buttonLabel = $derived(() => {
    if (!videoData?.isDownloadable) {
      return "N/A";
    }

    if (isDone) {
      return "Done";
    }

    if (isQueued) {
      return "Queued";
    }

    if (isDownloading) {
      return "Cancel";
    }

    return "Download";
  });

  const selectedVideoFormat = $derived(
    videoData?.videoFormats[0] ?? null
  );
  const selectedAudioFormat = $derived(
    videoData?.audioFormats[0] ?? null
  );

  async function toggleDownload() {
    if (!videoData?.isDownloadable) {
      return;
    }

    isDone = false;
    isDownloading = !isDownloading;
    progress = 0;

    if (!isDownloading || isQueued) {
      await sendMessage("cancelDownload", { videoIds: [videoId] });
      return;
    }

    const filenameOutput = getCompatibleFilename(
      `${videoData.title}.${videoData.isMusic ? options.ext.audio : options.ext.video}`
    );

    void pageMessenger.sendMessage("downloadRequest", {
      type: videoData.isMusic ? "audio" : "video+audio",
      videoId,
      videoItag: selectedVideoFormat?.itag ?? 0,
      audioItag: selectedAudioFormat?.itag ?? 0,
      filenameOutput,
      sabrConfig: videoData.sabrConfig
    });
  }
</script>

<div class="playlist-item-downloader">
  {#if videoData}
    <button
      class="download-button"
      class:download-button--disabled={!videoData.isDownloadable}
      class:download-button--done={isDone}
      class:download-button--downloading={isDownloading}
      aria-busy={isDownloading && !isDone}
      aria-label={`${buttonLabel()} ${videoData.title}`}
      disabled={!videoData.isDownloadable}
      onclick={toggleDownload}
    >
      {#if isDownloading && progress > 0 && progress < 1}
        <span
          style="--fill-scale: {progress};"
          class="download-progress"
          aria-hidden="true"
        ></span>
      {/if}
      <svg
        aria-hidden="true"
        fill="currentColor"
        focusable="false"
        height="20"
        width="20"
      >
        {#if isDownloading}
          <path
            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12
               5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"
          />
        {:else if isDone}
          <path
            d="M20.13,5.41 18.72,4 9.53,13.19 5.28,8.95 3.87,10.36
               9.53,16.02M5 18h14v2H5z"
          />
        {:else}
          <path
            d="M17 18V19H6V18H17ZM16.5 11.4L15.8 10.7L12 14.4V4H11V14.4
               L7.2 10.6L6.5 11.3L11.5 16.3L16.5 11.4Z"
          />
        {/if}
      </svg>
      <span class="button-text">{buttonLabel()}</span>
    </button>
  {:else}
    <div class="loading-indicator" aria-busy="true" aria-label="Loading video info">
      <div class="spinner"></div>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
  }

  :host {
    display: contents;
  }

  .playlist-item-downloader {
    display: flex;
    align-items: center;
  }

  .download-button {
    position: relative;
    display: flex;
    gap: 4px;
    align-items: center;
    overflow: hidden;
    padding: 4px 8px;
    border: 1px solid var(--yt-spec-10-percent-layer, rgb(0 0 0 / 20%));
    border-radius: 12px;
    background: transparent;
    color: var(--yt-spec-text-secondary, rgb(96 96 96));
    font-family: Roboto, Arial, sans-serif;
    font-size: 1.2rem;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 100ms, border-color 100ms;
  }

  .download-button:hover:not(:disabled) {
    border-color: var(--yt-spec-text-secondary, rgb(96 96 96));
    background-color: var(--yt-spec-10-percent-layer, rgb(0 0 0 / 5%));
  }

  .download-button--disabled {
    opacity: 40%;
    cursor: default;
  }

  .download-button--done {
    border-color: currentColor;
    color: var(--yt-spec-brand-icon-active, rgb(6 95 212));
  }

  .download-progress {
    --fill-scale: 0;

    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: var(--yt-spec-brand-icon-active, rgb(6 95 212));
    opacity: 15%;
    transition: transform 200ms;
    transform: scaleX(var(--fill-scale));
    transform-origin: left;
  }

  .button-text {
    position: relative;
    z-index: 1;
    font-weight: 500;
    font-size: 1.2rem;
  }

  .loading-indicator {
    padding: 4px 8px;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--yt-spec-10-percent-layer, rgb(0 0 0 / 20%));
    border-top-color: var(--yt-spec-text-secondary, rgb(96 96 96));
    border-radius: 50%;
    animation: 800ms spin linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
