<script lang="ts">
  import SettingsTab from "./SettingsTab.svelte";
  import { MessageType, sendMessage } from "@/lib/messaging";
  import {
    isFFmpegReadyItem,
    musicListItem,
    optionsItem,
    statusProgressItem,
    videoDetailsItem,
    videoOnlyListItem,
    videoQueueItem
  } from "@/lib/storage";
  import { initialOptions as defaultOptions } from "@/lib/utils";
  import { ProgressType } from "@/types";
  import type { Options, VideoQueueItem } from "@/types";
  import { onMount, untrack } from "svelte";

  const percentFormatter = new Intl.NumberFormat(browser.i18n.getUILanguage(), {
    style: "percent",
    maximumFractionDigits: 1
  });

  // --- Props (pre-fetched in main.ts for instant render) ---------------------

  type Props = {
    initialIsFFmpegReady: boolean;
    initialVideoQueue: VideoQueueItem[];
    initialMusicList: string[];
    initialVideoOnlyList: string[];
    initialVideoDetails: Record<string, { filenameOutput: string }>;
    initialStatusProgress: Record<string, {
      progress: number;
      progressType: ProgressType;
    }>;
    initialOptions: Options;
  };

  const {
    initialIsFFmpegReady,
    initialVideoQueue,
    initialMusicList,
    initialVideoOnlyList,
    initialVideoDetails,
    initialStatusProgress,
    initialOptions
  }: Props = $props();

  // --- State -----------------------------------------------------------------

  let activeTab = $state<"queue" | "settings">("queue");
  let isFFmpegReady = $state(untrack(() => initialIsFFmpegReady));
  let videoDownloads = $state(untrack(() => initialVideoQueue));
  let musicList = $state(untrack(() => initialMusicList));
  let videoOnlyList = $state(untrack(() => initialVideoOnlyList));
  let videoDetails = $state(untrack(() => initialVideoDetails));
  let statusProgress = $state(untrack(() => initialStatusProgress));
  let options = $state<Options>(untrack(() => initialOptions));
  let draggedVideoId = $state<string | null>(null);
  let dragOverVideoId = $state<string | null>(null);

  // --- Derived ---------------------------------------------------------------

  const totalActiveDownloads = $derived(
    videoDownloads.length + musicList.length + videoOnlyList.length
  );

  // --- Storage listener ------------------------------------------------------

  function listenToStorageChanges() {
    const unwatches = [
      isFFmpegReadyItem.watch(value => {
        isFFmpegReady = value ?? false;
      }),
      videoQueueItem.watch(value => {
        videoDownloads = value ?? [];
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
        options = value ?? { ...defaultOptions };
      })
    ];
    return () => {
      for (const unwatch of unwatches) {
        unwatch();
      }
    };
  }

  // --- Actions ---------------------------------------------------------------

  function cancelDownload(videoIds: string[]) {
    void sendMessage(MessageType.CancelDownload, { videoIds });
  }

  function cancelAllInQueue() {
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

    const fromIndex = videoDownloads.findIndex(
      item => item.videoId === draggedVideoId
    );
    const toIndex = videoDownloads.findIndex(
      item => item.videoId === dragOverVideoId
    );
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

  onMount(listenToStorageChanges);

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
</script>

{#snippet closeIcon()}
  <svg
    aria-hidden="true"
    fill="currentColor"
    height="16"
    viewBox="0 0 24 24"
    width="16"
  >
    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
  </svg>
{/snippet}

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
        {#if videoDownloads.length > 0}
          <section aria-labelledby="video-downloads-heading">
            <div class="section-header">
              <h2 id="video-downloads-heading" class="section-title">
                Video downloads
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
              aria-label="Active video downloads"
              role="list"
            >
              {#each videoDownloads as item, index (item.videoId)}
                {@const detail = videoDetails[item.videoId]}
                {@const progress = statusProgress[item.videoId]}
                <li
                  class="download-item"
                  class:download-item--current={index === 0}
                  class:download-item--drag-over={dragOverVideoId === item.videoId}
                  aria-label="{detail?.filenameOutput ?? item.videoId}"
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
                      <progress
                        class="download-progress"
                        aria-label={getProgressLabel(item.videoId)}
                        max={1}
                        value={progress.progress}
                      ></progress>
                      <span class="download-progress-label"
                        >{getProgressLabel(item.videoId)}</span
                      >
                    {:else if index === 0}
                      <span class="download-status-label">
                        {isFFmpegReady ? "Processing…" : "Waiting for FFmpeg…"}
                      </span>
                    {:else}
                      <span class="download-status-label">Downloading</span>
                    {/if}
                  </div>
                  <button
                    class="item-cancel-button"
                    aria-label="Cancel download of {detail?.filenameOutput ?? item.videoId}"
                    onclick={() => cancelDownload([item.videoId])}
                  >
                    {@render closeIcon()}
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
                      <progress
                        class="download-progress"
                        aria-label={getProgressLabel(videoId)}
                        max={1}
                        value={progress.progress}
                      ></progress>
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
                    {@render closeIcon()}
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
                      <progress
                        class="download-progress"
                        aria-label={getProgressLabel(videoId)}
                        max={1}
                        value={progress.progress}
                      ></progress>
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
                    {@render closeIcon()}
                  </button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/if}
    {:else}
      <SettingsTab {options} />
    {/if}
  </div>
</div>

<style>
  :global {
    html {
      font-size: max(1rem, 16px);
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    body {
    /* M3 Expressive - light theme tokens */
    --md-sys-color-surface: #fef7ff;
    --md-sys-color-surface-container: #f3edf7;
    --md-sys-color-surface-container-high: #ece6f0;
    --md-sys-color-surface-container-highest: #e6e0e9;
    --md-sys-color-on-surface: #1d1b20;
    --md-sys-color-on-surface-variant: #49454f;
    --md-sys-color-outline: #79747e;
    --md-sys-color-outline-variant: #cac4d0;
    --md-sys-color-primary: #6750a4;
    --md-sys-color-on-primary: #fff;
    --md-sys-color-primary-container: #eaddff;
    --md-sys-color-secondary-container: #e8def8;
    --md-sys-color-error: #b3261e;
    --md-sys-color-error-container: #f9dedc;
    --md-sys-color-on-error-container: #410e0b;

    /* Semantic aliases */
    --bg: var(--md-sys-color-surface);
    --fg: var(--md-sys-color-on-surface);
    --fg-muted: var(--md-sys-color-on-surface-variant);
    --fg-subtle: var(--md-sys-color-outline);
    --border: var(--md-sys-color-outline-variant);
    --accent: var(--md-sys-color-primary);
    --accent-container: var(--md-sys-color-primary-container);
    --accent-hover: var(--md-sys-color-secondary-container);
    --danger: var(--md-sys-color-error);
    --danger-hover: var(--md-sys-color-error-container);
    --surface: var(--md-sys-color-surface-container);
    --surface-high: var(--md-sys-color-surface-container-high);

    width: 420px;
    margin: 0;
    background-color: var(--bg);
    color: var(--fg);
    font-family: "Google Sans", Roboto, Arial, sans-serif;
    font-size: 0.875rem;
    line-height: 1.5;

    @media (prefers-color-scheme: dark) {
      --md-sys-color-surface: #141218;
      --md-sys-color-surface-container: #211f26;
      --md-sys-color-surface-container-high: #2b2930;
      --md-sys-color-surface-container-highest: #36343b;
      --md-sys-color-on-surface: #e6e0e9;
      --md-sys-color-on-surface-variant: #cac4d0;
      --md-sys-color-outline: #938f99;
      --md-sys-color-outline-variant: #49454f;
      --md-sys-color-primary: #d0bcff;
      --md-sys-color-on-primary: #381e72;
      --md-sys-color-primary-container: #4f378b;
      --md-sys-color-secondary-container: #4a4458;
      --md-sys-color-error: #f2b8b5;
      --md-sys-color-error-container: #8c1d18;
      --md-sys-color-on-error-container: #f9dedc;
    }
  }
  }

  .popup-container {
    display: flex;
    flex-direction: column;
    max-height: 600px;
  }

  .popup-header {
    padding: 16px 16px 0;
    background: var(--bg);
  }

  .popup-header-top {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 12px;
  }

  .popup-title {
    color: var(--fg);
    font-weight: 500;
    font-size: 1.125rem;
    letter-spacing: 0;
  }

  .popup-credit {
    color: var(--fg-muted);
    font-size: 0.75rem;

    & a {
      color: var(--accent);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  /* M3 Expressive tabs - pill-shaped active indicator */
  .tab-nav {
    display: flex;
    gap: 4px;
    padding: 4px;
    border-radius: 16px;
    background: var(--surface);
  }

  .tab-nav-button {
    display: flex;
    flex: 1;
    gap: 6px;
    justify-content: center;
    align-items: center;
    padding: 8px 16px;
    border: none;
    border-radius: 12px;
    background: transparent;
    color: var(--fg-muted);
    font-family: inherit;
    font-weight: 500;
    font-size: 0.8125rem;
    white-space: nowrap;
    cursor: pointer;
    transition: background-color 200ms, color 200ms;

    &:hover {
      background: var(--accent-hover);
      color: var(--fg);
    }

    &:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
  }

  .tab-nav-button--active {
    background: var(--accent-container);
    color: var(--accent);
    font-weight: 600;
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
    font-size: 0.6875rem;
  }

  .popup-content {
    flex: 1;
    overflow-y: auto;
    min-height: 120px;
    padding: 16px;
  }

  /* -- Queue tab --------------------------------------------------------- */

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

  .download-item-content {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .download-filename {
    overflow: hidden;
    font-size: 0.75rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .download-progress {
    width: 100%;
    height: 4px;
    border: none;
    border-radius: 2px;
    appearance: none;

    &::-webkit-progress-bar {
      border-radius: 2px;
      background: var(--border);
    }

    &::-webkit-progress-value {
      border-radius: 2px;
      background: var(--accent);
      transition: width 300ms cubic-bezier(0.2, 0, 0, 1);
    }

    &::-moz-progress-bar {
      border-radius: 2px;
      background: var(--accent);
    }
  }

  .download-progress-label,
  .download-status-label {
    color: var(--fg-subtle);
    font-size: 0.6875rem;
  }

  .item-cancel-button {
    display: flex;
    flex-shrink: 0;
    justify-content: center;
    align-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: 14px;
    background: transparent;
    color: var(--fg-subtle);
    cursor: pointer;
    transition: background-color 200ms, color 200ms;

    &:hover {
      background: var(--danger-hover);
      color: var(--danger);
    }

    &:focus-visible {
      outline: 2px solid var(--danger);
      outline-offset: 2px;
    }
  }
</style>
