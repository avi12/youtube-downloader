<script lang="ts">
  import { createAppState, Tab } from "./App.state.svelte";
  import ChangeFormatDialog from "./ChangeFormatDialog.svelte";
  import DownloadsTab from "./DownloadsTab.svelte";
  import SettingsTab from "./SettingsTab.svelte";
  import TabNav from "./TabNav.svelte";
  import { ProgressType } from "@/types";
  import type { Options, VideoQueueItem } from "@/types";
  import { untrack } from "svelte";

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

  const percentFormatter = new Intl.NumberFormat(browser.i18n.getUILanguage(), {
    style: "percent",
    maximumFractionDigits: 1
  });

  const appState = createAppState(untrack(() => ({
    initialIsFFmpegReady,
    initialVideoQueue,
    initialMusicList,
    initialVideoOnlyList,
    initialVideoDetails,
    initialStatusProgress,
    initialOptions
  })));
</script>

<div class="popup-container">
  <header class="popup-header">
    <div class="popup-header-top">
      <h1 class="popup-title">YouTube Downloader</h1>
      <span class="popup-credit">
        by <a href="https://avi12.com" target="_blank">Avi</a>
      </span>
    </div>
    <TabNav activeTab={appState.activeTab} onChange={id => (appState.activeTab = id)} tabs={appState.tabs} />
  </header>

  <div
    id="panel-{appState.activeTab}"
    class="popup-content"
    role="tabpanel"
  >
    {#if appState.activeTab === Tab.Downloads}
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

  {#if appState.pendingFormatChangeEntry}
    <ChangeFormatDialog
      entry={appState.pendingFormatChangeEntry}
      onClose={appState.handleCloseDialog}
    />
  {/if}
</div>

<style>
  :global {
    html {
      font-size: max(1rem, 16px);
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    body {
      --md-sys-color-surface: #fef7ff;
      --md-sys-color-surface-container: #f3edf7;
      --md-sys-color-surface-container-high: #ece6f0;
      --md-sys-color-surface-container-highest: #e6e0e9;
      --md-sys-color-on-surface: #1d1b20;
      --md-sys-color-on-surface-variant: #49454f;
      --md-sys-color-outline: #79747e;
      --md-sys-color-outline-variant: #cac4d0;
      --md-sys-color-primary: #6750a4;
      --md-sys-color-on-primary: #ffffff;
      --md-sys-color-primary-container: #eaddff;
      --md-sys-color-secondary-container: #e8def8;
      --md-sys-color-error: #b3261e;
      --md-sys-color-error-container: #f9dedc;
      --md-sys-color-on-error-container: #410e0b;
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

  .popup-content {
    flex: 1;
    overflow-y: auto;
    min-height: 120px;
    padding: 16px;
  }
</style>
