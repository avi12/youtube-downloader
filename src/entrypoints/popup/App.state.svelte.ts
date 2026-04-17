import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { getAllRecentDownloads } from "@/lib/storage/recent-downloads-db";
import {
  isFFmpegReadyItem,
  musicListItem,
  optionsItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { initialOptions as defaultOptions } from "@/lib/youtube/video-helpers";
import { ProgressType } from "@/types";
import type { Options, RecentDownloadEntry, VideoQueueItem } from "@/types";

// TypeScript `enum` inside a Svelte component is flagged as a non-reactive update by the compiler.
export const PopupPanel = {
  Downloads: "downloads",
  Settings: "settings"
} as const;

export type PopupPanel = (typeof PopupPanel)[keyof typeof PopupPanel];

const relativeAgeTickMs = 30_000;

export function createAppState(props: {
  initialIsFFmpegReady: boolean;
  initialVideoQueue: VideoQueueItem[];
  initialMusicList: string[];
  initialVideoOnlyList: string[];
  initialVideoDetails: Record<string, {
    filenameOutput: string;
  }>;
  initialStatusProgress: Record<string, {
    progress: number;
    progressType: ProgressType;
  }>;
  initialOptions: Options;
}) {
  let activePanel = $state<PopupPanel>(PopupPanel.Downloads);
  let isFFmpegReady = $state(props.initialIsFFmpegReady);
  let videoDownloads = $state(props.initialVideoQueue);
  let musicList = $state(props.initialMusicList);
  let videoOnlyList = $state(props.initialVideoOnlyList);
  let videoDetails = $state(props.initialVideoDetails);
  let statusProgress = $state(props.initialStatusProgress);
  let options = $state<Options>(props.initialOptions);
  let recentDownloads = $state<RecentDownloadEntry[]>([]);
  let now = $state(Date.now());
  let pendingFormatChangeEntry = $state<RecentDownloadEntry | null>(null);

  async function refreshRecentDownloads() {
    recentDownloads = await getAllRecentDownloads();
  }

  const totalActiveDownloads = $derived(videoDownloads.length + musicList.length + videoOnlyList.length);

  const tabs = $derived([
    {
      id: PopupPanel.Downloads,
      label: "Downloads",
      badge: totalActiveDownloads
    },
    {
      id: PopupPanel.Settings,
      label: "Settings"
    }
  ]);

  $effect(() => {
    void refreshRecentDownloads();
    const popupPort = browser.runtime.connect({ name: "popup" });
    const unregisterRecentHandler = onMessage(MessageType.RecentDownloadsChanged, () => {
      void refreshRecentDownloads();
    });
    const relativeAgeTimer = setInterval(() => {
      now = Date.now();
    }, relativeAgeTickMs);

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

      unregisterRecentHandler();
      clearInterval(relativeAgeTimer);
      popupPort.disconnect();
    };
  });

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
