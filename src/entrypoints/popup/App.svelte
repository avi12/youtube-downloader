<script lang="ts">
  import { MessageType, sendMessage } from "../../lib/messaging";
  import {
    isFFmpegReadyItem,
    musicListItem,
    optionsItem,
    setOption,
    statusProgressItem,
    videoDetailsItem,
    videoOnlyListItem,
    videoQueueItem
  } from "../../lib/storage";
  import { initialOptions, supportedExtensions, videoQualities } from "../../lib/utils";
  import type { Options, ProgressType, VideoQueueItem } from "../../types";
  import { onMount } from "svelte";

  // --- State -----------------------------------------------------------------

  let activeTab = $state<"queue" | "settings">("queue");
  let isFFmpegReady = $state(false);
  let videoQueue = $state<VideoQueueItem[]>([]);
  let musicList = $state<string[]>([]);
  let videoOnlyList = $state<string[]>([]);
  let videoDetails = $state<
    Record<string, { filenameOutput: string }>
  >({});
  let statusProgress = $state<
    Record<string, { progress: number; progressType: ProgressType }>
  >({});
  let options = $state<Options>({ ...initialOptions });
  let draggedVideoId = $state<string | null>(null);
  let dragOverVideoId = $state<string | null>(null);

  // --- Derived ---------------------------------------------------------------

  const totalActiveDownloads = $derived(
    videoQueue.length + musicList.length + videoOnlyList.length
  );

  // --- Storage listener ------------------------------------------------------

  function listenToStorageChanges() {
    const unwatches = [
      isFFmpegReadyItem.watch(value => {
        isFFmpegReady = value ?? false;
      }),
      videoQueueItem.watch(value => {
        videoQueue = value ?? [];
      }),
      musicListItem.watch(value => {
        musicList = value ?? [];
      }),
      videoOnlyListItem.watch(value => {
        videoOnlyList = value ?? [];
      }),
      videoDetailsItem.watch(value => {
        videoDetails = value ?? {};
      }),
      statusProgressItem.watch(value => {
        statusProgress = value ?? {};
      }),
      optionsItem.watch(value => {
        options = value ?? { ...initialOptions };
      })
    ];
    return () => {
      for (const unwatch of unwatches) {
        unwatch();
      }
    };
  }

  // --- Actions ---------------------------------------------------------------

  async function cancelDownload(videoIds: string[]) {
    await sendMessage(MessageType.CancelDownload, { videoIds });
  }

  async function cancelAllInQueue() {
    const allIds = videoQueue.map(item => item.videoId);
    if (allIds.length > 0) {
      await cancelDownload(allIds);
    }
  }

  async function cancelAllMusic() {
    if (musicList.length > 0) {
      await cancelDownload(musicList);
    }
  }

  async function cancelAllVideoOnly() {
    if (videoOnlyList.length > 0) {
      await cancelDownload(videoOnlyList);
    }
  }

  // Drag-and-drop reordering of video queue
  function handleDragStart(videoId: string) {
    draggedVideoId = videoId;
  }

  function handleDragOver(videoId: string) {
    dragOverVideoId = videoId;
  }

  async function handleDrop() {
    if (!draggedVideoId || !dragOverVideoId || draggedVideoId === dragOverVideoId) {
      return;
    }

    const fromIndex = videoQueue.findIndex(
      item => item.videoId === draggedVideoId
    );
    const toIndex = videoQueue.findIndex(
      item => item.videoId === dragOverVideoId
    );
    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const reordered = [...videoQueue];
    const [removed] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, removed);

    await videoQueueItem.setValue(reordered);

    draggedVideoId = null;
    dragOverVideoId = null;
  }

  // --- Settings --------------------------------------------------------------

  async function updateAudioExtension(extension: string) {
    await setOption("ext", { ...options.ext, audio: extension });
  }

  async function updateVideoExtension(extension: string) {
    await setOption("ext", { ...options.ext, video: extension });
  }

  async function updateVideoQualityMode(
    mode: Options["videoQualityMode"]
  ) {
    await setOption("videoQualityMode", mode);
  }

  async function updateVideoQuality(quality: number) {
    await setOption("videoQuality", quality);
  }

  async function updateRemoveNativeDownload(remove: boolean) {
    await setOption("isRemoveNativeDownload", remove);
  }

  function handleAudioExtensionChange(e: Event) {
    const { target } = e;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    void updateAudioExtension(target.value);
  }

  function handleVideoExtensionChange(e: Event) {
    const { target } = e;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    void updateVideoExtension(target.value);
  }

  function handleVideoQualityChange(e: Event) {
    const { target } = e;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    void updateVideoQuality(Number(target.value));
  }

  function handleRemoveNativeDownloadChange(e: Event) {
    const { target } = e;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    void updateRemoveNativeDownload(target.checked);
  }

  // --- Lifecycle -------------------------------------------------------------

  onMount(() => {
    async function initialize() {
      [
        isFFmpegReady,
        videoQueue,
        musicList,
        videoOnlyList,
        videoDetails,
        statusProgress,
        options
      ] = await Promise.all([
        isFFmpegReadyItem.getValue(),
        videoQueueItem.getValue(),
        musicListItem.getValue(),
        videoOnlyListItem.getValue(),
        videoDetailsItem.getValue(),
        statusProgressItem.getValue(),
        optionsItem.getValue()
      ]);
    }

    void initialize();
    return listenToStorageChanges();
  });

  function getProgressLabel(videoId: string) {
    const prog = statusProgress[videoId];
    if (!prog) {
      return "";
    }

    const percentage = (prog.progress * 100).toFixed(1);
    if (prog.progressType === "ffmpeg") {
      return `${percentage}% stitching`;
    }

    return `${percentage}% (${prog.progressType})`;
  }
</script>

<div class="popup-container">
  <header class="popup-header">
    <h1 class="popup-title">YouTube Downloader</h1>
    <nav class="tab-nav" aria-label="Navigation">
      <button
        class="tab-nav-button"
        class:tab-nav-button--active={activeTab === "queue"}
        aria-pressed={activeTab === "queue"}
        onclick={() => (activeTab = "queue")}
      >
        Downloads
        {#if totalActiveDownloads > 0}
          <span class="badge" aria-label="{totalActiveDownloads} active"
            >{totalActiveDownloads}</span
          >
        {/if}
      </button>
      <button
        class="tab-nav-button"
        class:tab-nav-button--active={activeTab === "settings"}
        aria-pressed={activeTab === "settings"}
        onclick={() => (activeTab = "settings")}
      >
        Settings
      </button>
    </nav>
  </header>

  <main class="popup-content">
    {#if activeTab === "queue"}
      <!-- --- Queue tab ------------------------------------------------ -->
      {#if totalActiveDownloads === 0}
        <p class="empty-state">No active downloads</p>
      {:else}
        <!-- Video+Audio queue (FFmpeg) -->
        {#if videoQueue.length > 0}
          <section aria-labelledby="video-queue-heading">
            <div class="section-header">
              <h2 id="video-queue-heading" class="section-title">
                Video queue
                {#if !isFFmpegReady}
                  <span class="loading-badge" aria-label="FFmpeg loading">
                    Loading FFmpeg…
                  </span>
                {/if}
              </h2>
              <button
                class="cancel-all-button"
                aria-label="Cancel all video downloads"
                onclick={cancelAllInQueue}
              >
                Cancel all
              </button>
            </div>

            <ul
              class="download-list"
              aria-label="Video download queue"
              role="list"
            >
              {#each videoQueue as item, index (item.videoId)}
                {@const detail = videoDetails[item.videoId]}
                {@const progress = statusProgress[item.videoId]}
                <li
                  class="download-item"
                  class:download-item--current={index === 0}
                  class:download-item--drag-over={dragOverVideoId === item.videoId}
                  aria-label="Queue position {index + 1}: {detail?.filenameOutput ?? item.videoId}"
                  draggable="true"
                  ondragover={e => {
                    e.preventDefault();
                    handleDragOver(item.videoId);
                  }}
                  ondragstart={() => handleDragStart(item.videoId)}
                  ondrop={handleDrop}
                  role="listitem"
                >
                  <span class="queue-position" aria-hidden="true"
                    >{index + 1}</span
                  >
                  <div class="download-item-content">
                    <span class="download-filename"
                      >{detail?.filenameOutput ?? item.videoId}</span
                    >
                    {#if progress}
                      <div
                        class="download-progress"
                        aria-label={getProgressLabel(item.videoId)}
                        aria-valuemax={1}
                        aria-valuemin={0}
                        aria-valuenow={progress.progress}
                        role="progressbar"
                      >
                        <div
                          style="--fill-scale: {progress.progress};"
                          class="download-progress-fill"
                        ></div>
                      </div>
                      <span class="download-progress-label"
                        >{getProgressLabel(item.videoId)}</span
                      >
                    {:else if index === 0}
                      <span class="download-status-label">
                        {isFFmpegReady ? "Processing…" : "Waiting for FFmpeg…"}
                      </span>
                    {:else}
                      <span class="download-status-label">Queued</span>
                    {/if}
                  </div>
                  <button
                    class="item-cancel-button"
                    aria-label="Cancel download of {detail?.filenameOutput ?? item.videoId}"
                    onclick={() => cancelDownload([item.videoId])}
                  >
                    ×
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <!-- Music / audio-only downloads -->
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
                {@const detail = videoDetails[videoId]}
                {@const progress = statusProgress[videoId]}
                <li class="download-item" role="listitem">
                  <div class="download-item-content">
                    <span class="download-filename"
                      >{detail?.filenameOutput ?? videoId}</span
                    >
                    {#if progress}
                      <div
                        class="download-progress"
                        aria-label={getProgressLabel(videoId)}
                        aria-valuemax={1}
                        aria-valuemin={0}
                        aria-valuenow={progress.progress}
                        role="progressbar"
                      >
                        <div
                          style="--fill-scale: {progress.progress};"
                          class="download-progress-fill"
                        ></div>
                      </div>
                      <span class="download-progress-label"
                        >{getProgressLabel(videoId)}</span
                      >
                    {/if}
                  </div>
                  <button
                    class="item-cancel-button"
                    aria-label="Cancel audio download of {detail?.filenameOutput ?? videoId}"
                    onclick={() => cancelDownload([videoId])}
                  >
                    ×
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <!-- Video-only downloads -->
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

            <ul
              class="download-list"
              aria-label="Video-only downloads"
              role="list"
            >
              {#each videoOnlyList as videoId (videoId)}
                {@const detail = videoDetails[videoId]}
                {@const progress = statusProgress[videoId]}
                <li class="download-item" role="listitem">
                  <div class="download-item-content">
                    <span class="download-filename"
                      >{detail?.filenameOutput ?? videoId}</span
                    >
                    {#if progress}
                      <div
                        class="download-progress"
                        aria-label={getProgressLabel(videoId)}
                        aria-valuemax={1}
                        aria-valuemin={0}
                        aria-valuenow={progress.progress}
                        role="progressbar"
                      >
                        <div
                          style="--fill-scale: {progress.progress};"
                          class="download-progress-fill"
                        ></div>
                      </div>
                      <span class="download-progress-label"
                        >{getProgressLabel(videoId)}</span
                      >
                    {/if}
                  </div>
                  <button
                    class="item-cancel-button"
                    aria-label="Cancel video-only download of {detail?.filenameOutput ?? videoId}"
                    onclick={() => cancelDownload([videoId])}
                  >
                    ×
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/if}
    {:else}
      <!-- --- Settings tab ---------------------------------------------- -->
      <div class="settings-container">
        <!-- Audio extension -->
        <fieldset class="settings-group">
          <legend class="settings-legend">Default audio format</legend>
          <div class="settings-row">
            <label class="settings-label" for="audio-ext-select">Format</label>
            <select
              id="audio-ext-select"
              class="settings-select"
              onchange={handleAudioExtensionChange}
              value={options.ext.audio}
            >
              {#each supportedExtensions.audio as ext (ext)}
                <option selected={ext === options.ext.audio} value={ext}
                  >{ext}</option
                >
              {/each}
            </select>
          </div>
        </fieldset>

        <!-- Video extension -->
        <fieldset class="settings-group">
          <legend class="settings-legend">Default video format</legend>
          <div class="settings-row">
            <label class="settings-label" for="video-ext-select">Format</label>
            <select
              id="video-ext-select"
              class="settings-select"
              onchange={handleVideoExtensionChange}
              value={options.ext.video}
            >
              {#each supportedExtensions.video as ext (ext)}
                <option selected={ext === options.ext.video} value={ext}
                  >{ext}</option
                >
              {/each}
            </select>
          </div>
        </fieldset>

        <!-- Video quality -->
        <fieldset class="settings-group">
          <legend class="settings-legend">Video quality</legend>

          <div class="settings-row">
            <label class="settings-label settings-radio-label">
              <input
                name="quality-mode"
                checked={options.videoQualityMode === "current-quality"}
                onchange={() => updateVideoQualityMode("current-quality")}
                type="radio"
                value="current-quality"
              />
              Match current player quality
            </label>
          </div>

          <div class="settings-row">
            <label class="settings-label settings-radio-label">
              <input
                name="quality-mode"
                checked={options.videoQualityMode === "best"}
                onchange={() => updateVideoQualityMode("best")}
                type="radio"
                value="best"
              />
              Best available quality
            </label>
          </div>

          <div class="settings-row">
            <label class="settings-label settings-radio-label">
              <input
                name="quality-mode"
                checked={options.videoQualityMode === "custom"}
                onchange={() => updateVideoQualityMode("custom")}
                type="radio"
                value="custom"
              />
              Custom quality
            </label>
            {#if options.videoQualityMode === "custom"}
              <div class="settings-sub-row">
                <label class="settings-label" for="custom-quality-select">
                  Quality
                </label>
                <select
                  id="custom-quality-select"
                  class="settings-select"
                  onchange={handleVideoQualityChange}
                  value={options.videoQuality}
                >
                  {#each videoQualities as quality (quality)}
                    <option
                      selected={quality === options.videoQuality}
                      value={quality}
                      >{quality}p</option
                    >
                  {/each}
                </select>
              </div>
            {/if}
          </div>
        </fieldset>

        <!-- Remove native download button -->
        <fieldset class="settings-group">
          <legend class="settings-legend">YouTube integration</legend>
          <div class="settings-row">
            <label class="settings-label settings-toggle-label">
              <input
                checked={options.isRemoveNativeDownload}
                onchange={handleRemoveNativeDownloadChange}
                type="checkbox"
              />
              Hide YouTube's native download button
            </label>
          </div>
        </fieldset>

        <footer class="settings-footer">
          <p>
            Made by <a href="https://avi12.com" rel="noopener noreferrer" target="_blank"
              >avi12</a
            >
          </p>
        </footer>
      </div>
    {/if}
  </main>
</div>

<style>
  :global(html) {
    font-size: 0.625em;
  }

  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(body) {
    overflow: hidden;
    width: 420px;
    min-height: 200px;
    max-height: 600px;
    background-color: rgb(255 255 255);
    color: rgb(15 15 15);
    font-family: Roboto, Arial, sans-serif;
    font-size: 1.4rem;
    line-height: 1.5;
  }

  @media (prefers-color-scheme: dark) {
    :global(body) {
      background-color: rgb(33 33 33);
      color: rgb(232 232 232);
    }
  }

  .popup-container {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .popup-header {
    position: sticky;
    top: 0;
    z-index: 10;
    padding-block: 12px 0;
    padding-inline: 16px;
    border-bottom: 1px solid rgb(0 0 0 / 10%);
    background: rgb(255 255 255);
  }

  @media (prefers-color-scheme: dark) {
    .popup-header {
      border-bottom-color: rgb(255 255 255 / 10%);
      background: rgb(33 33 33);
    }
  }

  .popup-title {
    margin-bottom: 8px;
    color: inherit;
    font-weight: 600;
    font-size: 1.6rem;
  }

  .tab-nav {
    display: flex;
    gap: 0;
  }

  .tab-nav-button {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 8px 12px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: rgb(0 0 0 / 60%);
    font-family: inherit;
    font-weight: 500;
    font-size: 1.3rem;
    white-space: nowrap;
    cursor: pointer;
    transition: color 150ms, border-color 150ms;
  }

  .tab-nav-button:hover {
    color: rgb(15 15 15);
  }

  .tab-nav-button--active {
    border-bottom-color: rgb(15 15 15);
    color: rgb(15 15 15);
  }

  @media (prefers-color-scheme: dark) {
    .tab-nav-button {
      color: rgb(255 255 255 / 60%);
    }

    .tab-nav-button:hover,
    .tab-nav-button--active {
      color: rgb(232 232 232);
    }

    .tab-nav-button--active {
      border-bottom-color: rgb(232 232 232);
    }
  }

  .badge {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: rgb(204 0 0);
    color: rgb(255 255 255);
    font-weight: 600;
    font-size: 1.1rem;
  }

  .popup-content {
    flex: 1;
    overflow-y: auto;
    max-height: 500px;
    padding: 12px 16px;
  }

  /* -- Queue tab --------------------------------------------------------- */

  .empty-state {
    padding: 24px 0;
    color: rgb(0 0 0 / 50%);
    font-size: 1.3rem;
    text-align: center;
  }

  @media (prefers-color-scheme: dark) {
    .empty-state {
      color: rgb(255 255 255 / 50%);
    }
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
    color: inherit;
    font-weight: 600;
    font-size: 1.3rem;
  }

  .loading-badge {
    color: rgb(0 0 0 / 50%);
    font-weight: 400;
    font-size: 1.1rem;
  }

  @media (prefers-color-scheme: dark) {
    .loading-badge {
      color: rgb(255 255 255 / 50%);
    }
  }

  .cancel-all-button {
    padding: 2px 4px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: rgb(204 0 0);
    font-family: inherit;
    font-size: 1.2rem;
    cursor: pointer;
  }

  .cancel-all-button:hover {
    background: rgb(204 0 0 / 10%);
  }

  .download-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    list-style: none;
  }

  .download-item {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding: 8px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: rgb(0 0 0 / 3%);
    transition: background-color 100ms;
  }

  .download-item--current {
    border-color: rgb(6 95 212 / 20%);
    background: rgb(6 95 212 / 5%);
  }

  .download-item--drag-over {
    border-color: rgb(6 95 212);
  }

  .download-item[draggable="true"] {
    cursor: grab;
  }

  .download-item[draggable="true"]:active {
    cursor: grabbing;
  }

  @media (prefers-color-scheme: dark) {
    .download-item {
      background: rgb(255 255 255 / 5%);
    }

    .download-item--current {
      background: rgb(6 95 212 / 10%);
    }
  }

  .queue-position {
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border-radius: 50%;
    background: rgb(0 0 0 / 10%);
    font-weight: 600;
    font-size: 1.1rem;
  }

  @media (prefers-color-scheme: dark) {
    .queue-position {
      background: rgb(255 255 255 / 10%);
    }
  }

  .download-item-content {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .download-filename {
    overflow: hidden;
    font-size: 1.2rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .download-progress {
    overflow: hidden;
    height: 3px;
    border-radius: 2px;
    background: rgb(0 0 0 / 10%);
  }

  @media (prefers-color-scheme: dark) {
    .download-progress {
      background: rgb(255 255 255 / 10%);
    }
  }

  .download-progress-fill {
    --fill-scale: 0;

    width: 100%;
    height: 100%;
    border-radius: 2px;
    background: rgb(6 95 212);
    transition: transform 200ms;
    transform: scaleX(var(--fill-scale));
    transform-origin: left;
  }

  .download-progress-label,
  .download-status-label {
    color: rgb(0 0 0 / 50%);
    font-size: 1.1rem;
  }

  @media (prefers-color-scheme: dark) {
    .download-progress-label,
    .download-status-label {
      color: rgb(255 255 255 / 50%);
    }
  }

  .item-cancel-button {
    flex-shrink: 0;
    padding: 2px 4px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: rgb(0 0 0 / 40%);
    font-size: 1.6rem;
    line-height: 1;
    cursor: pointer;
    transition: background-color 100ms, color 100ms;
  }

  .item-cancel-button:hover {
    background: rgb(204 0 0 / 10%);
    color: rgb(204 0 0);
  }

  @media (prefers-color-scheme: dark) {
    .item-cancel-button {
      color: rgb(255 255 255 / 40%);
    }
  }

  /* -- Settings tab ------------------------------------------------------- */

  .settings-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .settings-group {
    padding: 12px;
    border: 1px solid rgb(0 0 0 / 10%);
    border-radius: 6px;
  }

  @media (prefers-color-scheme: dark) {
    .settings-group {
      border-color: rgb(255 255 255 / 10%);
    }
  }

  .settings-legend {
    padding: 0 4px;
    color: rgb(0 0 0 / 60%);
    font-weight: 600;
    font-size: 1.2rem;
  }

  @media (prefers-color-scheme: dark) {
    .settings-legend {
      color: rgb(255 255 255 / 60%);
    }
  }

  .settings-row {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 0;
  }

  .settings-row + .settings-row {
    margin-top: 4px;
  }

  .settings-sub-row {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
    padding-left: 24px;
  }

  .settings-label {
    flex: 1;
    font-size: 1.3rem;
  }

  .settings-radio-label,
  .settings-toggle-label {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 1.3rem;
    cursor: pointer;
  }

  .settings-select {
    padding: 4px 8px;
    border: 1px solid rgb(0 0 0 / 20%);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 1.3rem;
    cursor: pointer;
  }

  @media (prefers-color-scheme: dark) {
    .settings-select {
      border-color: rgb(255 255 255 / 20%);
    }
  }

  [type="radio"],
  [type="checkbox"] {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    accent-color: rgb(6 95 212);
    cursor: pointer;
  }

  .settings-footer {
    padding-top: 8px;
    color: rgb(0 0 0 / 50%);
    font-size: 1.2rem;
    text-align: center;
  }

  @media (prefers-color-scheme: dark) {
    .settings-footer {
      color: rgb(255 255 255 / 50%);
    }
  }

  .settings-footer a {
    color: rgb(6 95 212);
    text-decoration: none;
  }

  .settings-footer a:hover {
    text-decoration: underline;
  }
</style>
