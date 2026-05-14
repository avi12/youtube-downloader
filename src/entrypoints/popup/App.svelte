<script lang="ts">
  import "./app.css";
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
