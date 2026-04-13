import { MessageType, onMessage } from "@/lib/messaging";
import { getAllRecentDownloads } from "@/lib/recent-downloads-db";
import {
  isFFmpegReadyItem,
  musicListItem,
  optionsItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage";
import { initialOptions as defaultOptions } from "@/lib/video-helpers";
import { ProgressType } from "@/types";
import type { Options, RecentDownloadEntry, VideoQueueItem } from "@/types";

// TypeScript `enum` inside a Svelte component is flagged as a non-reactive update by the compiler.
export const Tab = {
  Downloads: "downloads",
  Settings: "settings"
} as const;

export type Tab = (typeof Tab)[keyof typeof Tab];

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

const relativeAgeTickMs = 30_000;

export function createAppState(props: Props) {
  let activeTab = $state<Tab>(Tab.Downloads);
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
    { id: Tab.Downloads, label: "Downloads", badge: totalActiveDownloads },
    { id: Tab.Settings, label: "Settings" }
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
    get activeTab() {
      return activeTab;
    },
    set activeTab(value: Tab) {
      activeTab = value;
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
