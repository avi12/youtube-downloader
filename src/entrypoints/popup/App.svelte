<script lang="ts">
  import Autocomplete from "../../components/Autocomplete.svelte";
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
  import type { DownloadTypePreference, Options, ProgressType, VideoQueueItem } from "../../types";
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
    Record<string, { progress: number;
      progressType: ProgressType; }>
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

  function updateAudioExtension(extension: string) {
    void setOption("ext", {
      ...options.ext,
      audio: extension
    });
  }

  function updateVideoExtension(extension: string) {
    void setOption("ext", {
      ...options.ext,
      video: extension
    });
  }

  function updateDefaultDownloadType(type: DownloadTypePreference) {
    void setOption("defaultDownloadType", type);
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

  function handleTabKeydown(e: KeyboardEvent) {
    const tabs: ("queue" | "settings")[] = ["queue", "settings"];
    const iCurrent = tabs.indexOf(activeTab);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      activeTab = tabs[(iCurrent + 1) % tabs.length];
      document.getElementById(`tab-${activeTab}`)?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      activeTab = tabs[(iCurrent - 1 + tabs.length) % tabs.length];
      document.getElementById(`tab-${activeTab}`)?.focus();
    }
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
    <div class="popup-header-top">
      <h1 class="popup-title">YouTube Downloader</h1>
      <span class="popup-credit">
        by <a href="https://avi12.com" rel="noopener noreferrer" target="_blank">Avi</a>
      </span>
    </div>
    <div class="tab-nav" role="tablist">
      <button
        id="tab-queue"
        class="tab-nav-button"
        class:tab-nav-button--active={activeTab === "queue"}
        aria-controls="panel-queue"
        aria-selected={activeTab === "queue"}
        onclick={() => (activeTab = "queue")}
        onkeydown={handleTabKeydown}
        role="tab"
        tabindex={activeTab === "queue" ? 0 : -1}
      >
        Downloads
        {#if totalActiveDownloads > 0}
          <span class="badge" aria-label="{totalActiveDownloads} active"
            >{totalActiveDownloads}</span
          >
        {/if}
      </button>
      <button
        id="tab-settings"
        class="tab-nav-button"
        class:tab-nav-button--active={activeTab === "settings"}
        aria-controls="panel-settings"
        aria-selected={activeTab === "settings"}
        onclick={() => (activeTab = "settings")}
        onkeydown={handleTabKeydown}
        role="tab"
        tabindex={activeTab === "settings" ? 0 : -1}
      >
        Settings
      </button>
    </div>
  </header>

  <div
    id={activeTab === "queue" ? "panel-queue" : "panel-settings"}
    class="popup-content"
    aria-labelledby={activeTab === "queue" ? "tab-queue" : "tab-settings"}
    role="tabpanel"
  >
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
        <!-- Video format -->
        <fieldset class="settings-group">
          <legend class="settings-legend">Video format</legend>
          <Autocomplete
            id="video-ext"
            label="Container"
            onchange={updateVideoExtension}
            options={supportedExtensions.video}
            value={options.ext.video}
          />
        </fieldset>

        <!-- Audio format -->
        <fieldset class="settings-group">
          <legend class="settings-legend">Audio format</legend>
          <Autocomplete
            id="audio-ext"
            label="Container"
            onchange={updateAudioExtension}
            options={supportedExtensions.audio}
            value={options.ext.audio}
          />
          <p class="settings-hint">Used for audio-only downloads</p>
        </fieldset>

        <!-- Default download type -->
        <fieldset class="settings-group">
          <legend class="settings-legend">Download type</legend>
          <div class="settings-row">
            <label class="settings-label settings-radio-label">
              <input
                name="download-type"
                checked={options.defaultDownloadType === "auto"}
                onchange={() => updateDefaultDownloadType("auto")}
                type="radio"
                value="auto"
              />
              Auto (video for videos, audio for music)
            </label>
          </div>
          <div class="settings-row">
            <label class="settings-label settings-radio-label">
              <input
                name="download-type"
                checked={options.defaultDownloadType === "video+audio"}
                onchange={() => updateDefaultDownloadType("video+audio")}
                type="radio"
                value="video+audio"
              />
              Always video + audio
            </label>
          </div>
          <div class="settings-row">
            <label class="settings-label settings-radio-label">
              <input
                name="download-type"
                checked={options.defaultDownloadType === "video"}
                onchange={() => updateDefaultDownloadType("video")}
                type="radio"
                value="video"
              />
              Always video only
            </label>
          </div>
          <div class="settings-row">
            <label class="settings-label settings-radio-label">
              <input
                name="download-type"
                checked={options.defaultDownloadType === "audio"}
                onchange={() => updateDefaultDownloadType("audio")}
                type="radio"
                value="audio"
              />
              Always audio only
            </label>
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
      </div>
    {/if}
  </div>
</div>

<style>
  :global(html) {
    font-size: 0.625em;
  }

  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }

  :global(body) {
    --bg: rgb(255 255 255);
    --fg: rgb(15 15 15);
    --fg-muted: rgb(0 0 0 / 55%);
    --fg-subtle: rgb(0 0 0 / 45%);
    --border: rgb(0 0 0 / 10%);
    --accent: rgb(6 95 212);
    --accent-hover: rgb(6 95 212 / 10%);
    --danger: rgb(204 0 0);
    --danger-hover: rgb(204 0 0 / 10%);
    --surface: rgb(0 0 0 / 3%);
    --surface-active: rgb(6 95 212 / 5%);

    overflow: hidden;
    width: 420px;
    max-height: 600px;
    background-color: var(--bg);
    color: var(--fg);
    font-family: Roboto, Arial, sans-serif;
    font-size: 1.4rem;
    line-height: 1.5;

    @media (prefers-color-scheme: dark) {
      --bg: rgb(33 33 33);
      --fg: rgb(232 232 232);
      --fg-muted: rgb(255 255 255 / 75%);
      --fg-subtle: rgb(255 255 255 / 70%);
      --border: rgb(255 255 255 / 10%);
      --accent: rgb(100 160 235);
      --accent-hover: rgb(6 95 212 / 20%);
      --danger: rgb(204 0 0);
      --danger-hover: rgb(204 0 0 / 15%);
      --surface: rgb(255 255 255 / 5%);
      --surface-active: rgb(6 95 212 / 10%);
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
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .popup-header-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 8px;
  }

  .popup-title {
    color: inherit;
    font-weight: 600;
    font-size: 1.6rem;
  }

  .popup-credit {
    color: var(--fg-muted);
    font-size: 1.2rem;
  }

  .popup-credit a {
    color: var(--accent);
    text-decoration: none;
  }

  .popup-credit a:hover {
    text-decoration: underline;
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
    color: var(--fg-muted);
    font-family: inherit;
    font-weight: 500;
    font-size: 1.3rem;
    white-space: nowrap;
    cursor: pointer;
    transition: color 150ms, border-color 150ms;
  }

  .tab-nav-button:hover {
    color: var(--fg);
  }

  .tab-nav-button--active {
    border-bottom-color: var(--fg);
    color: var(--fg);
  }

  .badge {
    display: inline-flex;
    justify-content: center;
    align-items: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: var(--danger);
    color: rgb(255 255 255);
    font-weight: 600;
    font-size: 1.1rem;
  }

  .popup-content {
    flex: 1;
    overflow-y: auto;
    min-height: 120px;
    max-height: 500px;
    padding: 12px 16px;
  }

  /* -- Queue tab --------------------------------------------------------- */

  .empty-state {
    padding: 24px 0;
    color: var(--fg-subtle);
    font-size: 1.3rem;
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
    color: inherit;
    font-weight: 600;
    font-size: 1.3rem;
  }

  .loading-badge {
    color: var(--fg-subtle);
    font-weight: 400;
    font-size: 1.1rem;
  }

  .cancel-all-button {
    padding: 2px 4px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: var(--danger);
    font-family: inherit;
    font-size: 1.2rem;
    cursor: pointer;
  }

  .cancel-all-button:hover {
    background: var(--danger-hover);
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
    background: var(--surface);
    transition: background-color 100ms;
  }

  .download-item--current {
    border-color: rgb(6 95 212 / 20%);
    background: var(--surface-active);
  }

  .download-item--drag-over {
    border-color: var(--accent);
  }

  .download-item[draggable="true"] {
    cursor: grab;
  }

  .download-item[draggable="true"]:active {
    cursor: grabbing;
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
    background: var(--border);
    font-weight: 600;
    font-size: 1.1rem;
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
    background: var(--border);
  }

  .download-progress-fill {
    --fill-scale: 0;

    width: 100%;
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: transform 200ms;
    transform: scaleX(var(--fill-scale));
    transform-origin: left;
  }

  .download-progress-label,
  .download-status-label {
    color: var(--fg-subtle);
    font-size: 1.1rem;
  }

  .item-cancel-button {
    flex-shrink: 0;
    padding: 2px 4px;
    border: none;
    border-radius: 2px;
    background: transparent;
    color: var(--fg-subtle);
    font-size: 1.6rem;
    line-height: 1;
    cursor: pointer;
    transition: background-color 100ms, color 100ms;
  }

  .item-cancel-button:hover {
    background: var(--danger-hover);
    color: var(--danger);
  }

  /* -- Settings tab ------------------------------------------------------- */

  .settings-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .settings-group {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .settings-legend {
    padding: 0 4px;
    color: var(--fg-muted);
    font-weight: 600;
    font-size: 1.2rem;
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
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: 1.3rem;
    cursor: pointer;
  }

  [type="radio"],
  [type="checkbox"] {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .settings-hint {
    margin-top: 6px;
    color: var(--fg-muted);
    font-size: 1.1rem;
  }
</style>
