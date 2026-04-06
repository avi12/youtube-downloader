<script lang="ts">
  import DownloadsTab from "./DownloadsTab.svelte";
  import SettingsTab from "./SettingsTab.svelte";
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

  // --- Tabs ------------------------------------------------------------------

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
      <DownloadsTab
        {isFFmpegReady}
        {musicList}
        {percentFormatter}
        {statusProgress}
        {videoDetails}
        {videoDownloads}
        {videoOnlyList}
      />
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
</style>
