<script lang="ts">
  import { createAppState, PopupPanel } from "./App.state.svelte";
  import ChangeFormatDialog from "./ChangeFormatDialog.svelte";
  import DownloadsTab from "./DownloadsTab.svelte";
  import SettingsTab from "./SettingsTab.svelte";
  import TabNav from "./TabNav.svelte";
  import { ProgressType } from "@/types";
  import type { Options, VideoQueueItem } from "@/types";
  import { untrack } from "svelte";

  interface Props {
    initialIsFFmpegReady: boolean;
    initialVideoQueue: VideoQueueItem[];
    initialMusicList: string[];
    initialVideoOnlyList: string[];
    initialVideoDetails: Record<string, {
      filenameOutput: string;
      quality?: string;
    }>;
    initialStatusProgress: Record<string, {
      progress: number;
      progressType: ProgressType;
    }>;
    initialOptions: Options;
  }

  const {
    initialIsFFmpegReady,
    initialVideoQueue,
    initialMusicList,
    initialVideoOnlyList,
    initialVideoDetails,
    initialStatusProgress,
    initialOptions
  }: Props = $props();

  const percentFormatter = new Intl.NumberFormat(browser.i18n.getUILanguage(), {
    style: "percent",
    maximumFractionDigits: 1
  });

  const appState = createAppState(
    untrack(() => ({
      initialIsFFmpegReady,
      initialVideoQueue,
      initialMusicList,
      initialVideoOnlyList,
      initialVideoDetails,
      initialStatusProgress,
      initialOptions
    }))
  );
</script>

<div class="popup-container">
  <header class="popup-header">
    <div class="popup-header-top">
      <h1 class="popup-title">YouTube Downloader</h1>
      <span class="popup-credit">
        by <a href="https://avi12.com" target="_blank">Avi</a>
      </span>
    </div>
    <TabNav activeTab={appState.activePanel} onChange={id => (appState.activePanel = id)} tabs={appState.tabs} />
  </header>

  <div
    id="panel-{appState.activePanel}"
    class="popup-content"
    role="tabpanel"
  >
    {#if appState.activePanel === PopupPanel.Downloads}
      <DownloadsTab
        isFFmpegReady={appState.isFFmpegReady}
        musicList={appState.musicList}
        now={appState.now}
        onChangeFormat={appState.handleChangeFormat}
        onRecentChanged={appState.refreshRecentDownloads}
        {percentFormatter}
        recentDownloads={appState.recentDownloads}
        statusProgress={appState.statusProgress}
        videoDetails={appState.videoDetails}
        videoDownloads={appState.videoDownloads}
        videoOnlyList={appState.videoOnlyList}
      />
    {:else}
      <SettingsTab options={appState.options} />
    {/if}
  </div>
</div>

{#if appState.pendingFormatChangeEntry}
  <ChangeFormatDialog
    entry={appState.pendingFormatChangeEntry}
    onClose={appState.handleCloseDialog}
  />
{/if}

<style>
  :global {
    @media (prefers-reduced-motion: reduce) {
      *,
      *::before,
      *::after {
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
      }
    }

    html {
      font-size: max(1rem, 16px);
    }

    body {
      --md-sys-color-surface: oklch(98.4% 0.0128 321.9deg);
      --md-sys-color-surface-container: oklch(95.4% 0.0147 312.2deg);
      --md-sys-color-surface-container-high: oklch(93.3% 0.0148 312.2deg);
      --md-sys-color-surface-container-highest: oklch(91.4% 0.0137 314.8deg);
      --md-sys-color-on-surface: oklch(22.7% 0.01 303.7deg);
      --md-sys-color-on-surface-variant: oklch(39.8% 0.0174 303.7deg);
      --md-sys-color-outline: oklch(51.6% 0.0186 309.9deg);
      --md-sys-color-outline-variant: oklch(82.9% 0.0178 308.2deg);
      --md-sys-color-primary: oklch(49.6% 0.1305 293.7deg);
      --md-sys-color-on-primary: oklch(100% 0 0deg);
      --md-sys-color-primary-container: oklch(91.8% 0.0477 302.8deg);
      --md-sys-color-secondary-container: oklch(91.6% 0.0365 303.1deg);
      --md-sys-color-error: oklch(50.1% 0.1783 28.7deg);
      --md-sys-color-error-container: oklch(92.2% 0.0301 22.8deg);
      --md-sys-color-on-error-container: oklch(25.4% 0.0794 27.6deg);
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
      --on-danger: oklch(100% 0 0deg);
      --surface: var(--md-sys-color-surface-container);
      --surface-high: var(--md-sys-color-surface-container-high);

      width: 420px;
      min-height: 600px;
      margin: 0;
      background-color: var(--bg);
      color: var(--fg);
      font-family: "Google Sans", Roboto, Arial, sans-serif;
      font-size: 0.875rem;
      line-height: 1.5;

      @media (prefers-color-scheme: dark) {
        --md-sys-color-surface: oklch(18.7% 0.0124 300.4deg);
        --md-sys-color-surface-container: oklch(24.5% 0.0134 298.5deg);
        --md-sys-color-surface-container-high: oklch(28.6% 0.0129 298.6deg);
        --md-sys-color-surface-container-highest: oklch(33% 0.0125 298.8deg);
        --md-sys-color-on-surface: oklch(91.4% 0.0137 314.8deg);
        --md-sys-color-on-surface-variant: oklch(82.9% 0.0178 308.2deg);
        --md-sys-color-outline: oklch(65.7% 0.0153 304deg);
        --md-sys-color-outline-variant: oklch(39.8% 0.0174 303.7deg);
        --md-sys-color-primary: oklch(83.5% 0.0946 298deg);
        --md-sys-color-on-primary: oklch(32.5% 0.1353 291.2deg);
        --md-sys-color-primary-container: oklch(41% 0.1337 292.7deg);
        --md-sys-color-secondary-container: oklch(40.1% 0.034 298.6deg);
        --md-sys-color-error: oklch(83.4% 0.0677 22deg);
        --md-sys-color-error-container: oklch(42% 0.1473 28.1deg);
        --md-sys-color-on-error-container: oklch(92.2% 0.0301 22.8deg);
        --on-danger: oklch(25.4% 0.0794 27.6deg);
      }
    }
  }

  .popup-container {
    display: flex;
    flex-direction: column;
    height: 600px;
  }

  .popup-header {
    padding: 16px;
    padding-bottom: 0;
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

  .popup-content {
    flex: 1;
    overflow-y: auto;
    min-height: 120px;
    padding: 16px;
  }
</style>
