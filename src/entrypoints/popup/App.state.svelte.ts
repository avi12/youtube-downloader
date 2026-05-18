import type { InitialAppStateProps } from "./app-state-props";
import { setupAppWatchers } from "./app-watchers.svelte";
import { buildTabs, PopupPanel } from "./popup-panel";
import { getAllRecentDownloads } from "@/lib/storage/recent-downloads-db";
import type { Options, RecentDownloadEntry } from "@/types";

export { PopupPanel } from "./popup-panel";

export function createAppState(props: InitialAppStateProps) {
  let activePanel = $state<PopupPanel>(PopupPanel.Downloads);
  let isFFmpegReady = $state(props.initialIsFFmpegReady);
  let videoDownloads = $state(props.initialVideoQueue);
  let musicList = $state(props.initialMusicList);
  let videoOnlyList = $state(props.initialVideoOnlyList);
  let videoDetails = $state(props.initialVideoDetails);
  let statusProgress = $state(props.initialStatusProgress);
  const currentTabId = props.initialCurrentTabId;
  let options = $state<Options>(props.initialOptions);
  let recentDownloads = $state<RecentDownloadEntry[]>([]);
  let now = $state(Date.now());
  let pendingFormatChangeEntry = $state<RecentDownloadEntry | null>(null);

  async function refreshRecentDownloads() {
    recentDownloads = await getAllRecentDownloads();
  }

  const totalActiveDownloads = $derived(videoDownloads.length + musicList.length + videoOnlyList.length);

  const tabs = $derived(buildTabs(totalActiveDownloads));

  $effect(() => setupAppWatchers({
    setIsFFmpegReady: value => (isFFmpegReady = value),
    setVideoDownloads: value => (videoDownloads = value),
    setMusicList: value => (musicList = value),
    setVideoOnlyList: value => (videoOnlyList = value),
    setVideoDetails: value => (videoDetails = value),
    setStatusProgress: value => (statusProgress = value),
    setOptions: value => (options = value),
    setNow: value => (now = value),
    refreshRecentDownloads
  }));

  return {
    get activePanel() {
      return activePanel;
    },
    set activePanel(value: PopupPanel) {
      activePanel = value;
    },
    get isFFmpegReady() {
      return isFFmpegReady;
    },
    get videoDownloads() {
      return videoDownloads;
    },
    get musicList() {
      return musicList;
    },
    get videoOnlyList() {
      return videoOnlyList;
    },
    get videoDetails() {
      return videoDetails;
    },
    get currentTabId() {
      return currentTabId;
    },
    get statusProgress() {
      return statusProgress;
    },
    get options() {
      return options;
    },
    get recentDownloads() {
      return recentDownloads;
    },
    get now() {
      return now;
    },
    get pendingFormatChangeEntry() {
      return pendingFormatChangeEntry;
    },
    get totalActiveDownloads() {
      return totalActiveDownloads;
    },
    get tabs() {
      return tabs;
    },
    refreshRecentDownloads,
    handleChangeFormat(entry: RecentDownloadEntry) {
      pendingFormatChangeEntry = entry;
    },
    handleCloseDialog() {
      pendingFormatChangeEntry = null;
    }
  };
}
