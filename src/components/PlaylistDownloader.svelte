<script lang="ts">
  /**
   * Playlist-level download button.
   * Appears in the playlist header and allows downloading all checked videos.
   */
  import { sendMessage } from "../lib/messaging";
  import { pageMessenger } from "../lib/page-messenger";
  import { musicListItem, videoOnlyListItem, videoQueueItem } from "../lib/storage";
  import { getCompatibleFilename } from "../lib/utils";
  import type { DownloadType, Options, VideoData } from "../types";
  import { SvelteMap } from "svelte/reactivity";

  type Props = {
    options: Options;
  };

  const { options }: Props = $props();

  // Map of videoId to VideoData for all videos that have been fetched
  const videoDataMap = new SvelteMap<string, VideoData>();
  let checkedVideoIds = $state<Set<string>>(new Set());
  let isDownloading = $state(false);
  let downloadedCount = $state(0);
  let totalCount = $state(0);
  let error = $state("");

  // Collect video data as each playlist item reports in
  $effect(() => pageMessenger.onMessage("videoData", ({ data }) => {
    videoDataMap.set(data.videoId, data);
  }));

  // Track checkboxes for per-video selection
  function handleCheckboxChange(e: Event) {
    if (!(e.target instanceof HTMLInputElement)) {
      return;
    }

    const elTarget = e.target;
    if (!elTarget.matches("[data-ytdl-checkbox]")) {
      return;
    }

    const videoId = elTarget.dataset.videoId ?? "";
    if (!videoId) {
      return;
    }

    if (elTarget.checked) {
      checkedVideoIds = new Set([...checkedVideoIds, videoId]);
    } else {
      checkedVideoIds = new Set([...checkedVideoIds].filter(id => id !== videoId));
    }
  }

  $effect(() => {
    document.addEventListener("change", handleCheckboxChange);
    return () => document.removeEventListener("change", handleCheckboxChange);
  });

  const downloadableVideos = $derived(
    [...videoDataMap.values()].filter(data => data.isDownloadable)
  );

  const checkedDownloadableVideos = $derived(
    checkedVideoIds.size === 0
      ? downloadableVideos
      : downloadableVideos.filter(data => checkedVideoIds.has(data.videoId))
  );

  const downloadButtonLabel = $derived(() => {
    if (isDownloading) {
      return `Downloading ${downloadedCount}/${totalCount}`;
    }

    const count = checkedDownloadableVideos.length;
    if (count === 0) {
      return "No downloadable videos";
    }

    return `Download ${count} video${count === 1 ? "" : "s"}`;
  });

  async function startPlaylistDownload() {
    if (checkedDownloadableVideos.length === 0) {
      return;
    }

    error = "";
    isDownloading = true;
    totalCount = checkedDownloadableVideos.length;
    downloadedCount = 0;

    const downloadRequests = checkedDownloadableVideos.map(data => {
      const downloadType: DownloadType = data.isMusic ? "audio" : "video+audio";
      const extension = data.isMusic ? options.ext.audio : options.ext.video;
      const filenameOutput = getCompatibleFilename(`${data.title}.${extension}`);

      return {
        type: downloadType,
        videoId: data.videoId,
        videoItag: data.videoFormats[0]?.itag ?? 0,
        audioItag: data.audioFormats[0]?.itag ?? 0,
        filenameOutput,
        sabrConfig: data.sabrConfig
      };
    });

    try {
      await sendMessage("requestPlaylistDownload", { items: downloadRequests });
    } catch {
      error = "Failed to start downloads - please try again";
      isDownloading = false;
      return;
    }

    // Track completion via storage changes
    let stopWatching: (() => void) | null = null;

    async function checkCompletion() {
      const [queueValues, musicValues, videoOnlyValues] = await Promise.all([
        videoQueueItem.getValue(),
        musicListItem.getValue(),
        videoOnlyListItem.getValue()
      ]);

      const remaining = downloadRequests.filter(
        request =>
          queueValues.some(item => item.videoId === request.videoId) ||
          musicValues.includes(request.videoId) ||
          videoOnlyValues.includes(request.videoId)
      ).length;

      downloadedCount = totalCount - remaining;

      if (remaining === 0) {
        isDownloading = false;
        stopWatching?.();
        stopWatching = null;
      }
    }

    const unwatches = [
      videoQueueItem.watch(() => checkCompletion()),
      musicListItem.watch(() => checkCompletion()),
      videoOnlyListItem.watch(() => checkCompletion())
    ];
    stopWatching = () => unwatches.forEach(unwatch => unwatch());
  }

  async function cancelPlaylistDownload() {
    const videoIds = checkedDownloadableVideos.map(data => data.videoId);
    await sendMessage("cancelDownload", { videoIds });
    isDownloading = false;
    downloadedCount = 0;
  }

  function handleDownloadClick() {
    if (isDownloading) {
      cancelPlaylistDownload();
    } else {
      startPlaylistDownload();
    }
  }
</script>

<div class="playlist-downloader" aria-label="Playlist Downloader" role="region">
  {#if error}
    <div class="error-message" role="alert">{error}</div>
  {/if}

  <div class="controls">
    <button
      class="download-button"
      class:download-button--downloading={isDownloading}
      aria-busy={isDownloading}
      aria-label={downloadButtonLabel()}
      disabled={checkedDownloadableVideos.length === 0 && !isDownloading}
      onclick={handleDownloadClick}
    >
      <svg
        aria-hidden="true"
        fill="currentColor"
        focusable="false"
        height="24"
        width="24"
      >
        {#if isDownloading}
          <!-- Cancel icon -->
          <path
            d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59
               6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"
          />
        {:else}
          <!-- Download all icon -->
          <path
            d="M20.18 18.67V18H4.18V18.67H20.18ZM16.18 10.73L15.73 10.27
               L13.31 12.73V6H12.68V12.73L10.26 10.27L9.82 10.73L13 13.91
               L16.18 10.73Z"
          />
        {/if}
      </svg>
      <span>{downloadButtonLabel()}</span>
    </button>

    {#if isDownloading && totalCount > 0}
      <div
        class="progress-bar"
        aria-label={`${downloadedCount} of ${totalCount} downloaded`}
        aria-valuemax={totalCount}
        aria-valuemin={0}
        aria-valuenow={downloadedCount}
        role="progressbar"
      >
        <div
          style="--fill-scale: {downloadedCount / totalCount};"
          class="progress-fill"
        ></div>
      </div>
    {/if}
  </div>

  {#if downloadableVideos.length < videoDataMap.size}
    <p class="info-text" role="status">
      {videoDataMap.size - downloadableVideos.length} video{videoDataMap.size -
        downloadableVideos.length === 1
        ? ""
        : "s"} not downloadable (private or restricted)
    </p>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
  }

  :host {
    display: block;
    padding: 12px 0;
  }

  .playlist-downloader {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-family: Roboto, Arial, sans-serif;
  }

  .controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .download-button {
    display: inline-flex;
    gap: 8px;
    align-items: center;
    padding: 8px 16px;
    border: none;
    border-radius: 18px;
    background: var(--yt-spec-brand-button-background, rgb(6 95 212));
    color: rgb(255 255 255);
    font-family: inherit;
    font-weight: 500;
    font-size: 1.4rem;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 150ms;
  }

  .download-button:disabled {
    background: var(--yt-spec-10-percent-layer, rgb(0 0 0 / 10%));
    color: var(--yt-spec-text-disabled, rgb(0 0 0 / 38%));
    cursor: default;
  }

  .download-button:hover:not(:disabled) {
    background: var(--yt-spec-brand-button-background-hover, rgb(3 86 196));
  }

  .download-button--downloading {
    background: var(--yt-spec-error-indicator, rgb(204 0 0));
  }

  .download-button--downloading:hover:not(:disabled) {
    background: rgb(170 0 0);
  }

  .download-button svg {
    flex-shrink: 0;
  }

  .progress-bar {
    overflow: hidden;
    height: 4px;
    border-radius: 2px;
    background: var(--yt-spec-10-percent-layer, rgb(0 0 0 / 10%));
  }

  .progress-fill {
    --fill-scale: 0;

    width: 100%;
    height: 100%;
    border-radius: 2px;
    background: var(--yt-spec-brand-button-background, rgb(6 95 212));
    transition: transform 300ms ease;
    transform: scaleX(var(--fill-scale));
    transform-origin: left;
  }

  .info-text {
    margin: 0;
    color: var(--yt-spec-text-secondary, rgb(96 96 96));
    font-size: 1.2rem;
  }

  .error-message {
    padding: 8px 12px;
    border-radius: 4px;
    background: var(--yt-spec-error-indicator, rgb(204 0 0));
    color: rgb(255 255 255);
    font-size: 1.3rem;
  }
</style>
