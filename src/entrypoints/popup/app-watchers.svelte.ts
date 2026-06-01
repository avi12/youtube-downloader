import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { isFFmpegReadyItem } from "@/lib/storage/storage";
import {
  musicListItem,
  optionsItem,
  statusProgressItem,
  videoDetailsItem,
  videoOnlyListItem,
  videoQueueItem
} from "@/lib/storage/storage";
import { INITIAL_OPTIONS as defaultOptions } from "@/lib/youtube/video-helpers";
import type { DownloadProgressEntry, Options, VideoDetail, VideoQueueItem } from "@/types";

export interface AppWatcherTargets {
  setIsFFmpegReady: (value: boolean) => void;
  setVideoDownloads: (value: VideoQueueItem[]) => void;
  setMusicList: (value: string[]) => void;
  setVideoOnlyList: (value: string[]) => void;
  setVideoDetails: (value: Record<string, VideoDetail>) => void;
  setStatusProgress: (value: Record<string, DownloadProgressEntry>) => void;
  setOptions: (value: Options) => void;
  setNow: (value: number) => void;
  refreshRecentDownloads: () => Promise<void>;
}

const RELATIVE_AGE_TICK_MS = 30_000;

export function setupAppWatchers(targets: AppWatcherTargets) {
  void targets.refreshRecentDownloads();

  const popupPort = browser.runtime.connect({ name: "popup" });
  const unregisterRecentHandler = onMessage(MessageType.RecentDownloadsChanged, () => {
    void targets.refreshRecentDownloads();
  });
  const relativeAgeTimer = setInterval(() => {
    targets.setNow(Date.now());
  }, RELATIVE_AGE_TICK_MS);

  const unwatches = [
    isFFmpegReadyItem.watch(value => targets.setIsFFmpegReady(value ?? false)),
    videoQueueItem.watch(value => targets.setVideoDownloads(value ?? [])),
    musicListItem.watch(value => targets.setMusicList(value ?? [])),
    videoOnlyListItem.watch(value => targets.setVideoOnlyList(value ?? [])),
    videoDetailsItem.watch(value => targets.setVideoDetails(value ?? {})),
    statusProgressItem.watch(value => targets.setStatusProgress(value ?? {})),
    optionsItem.watch(value => targets.setOptions({
      ...defaultOptions,
      ...value
    }))
  ];

  return () => {
    for (const unwatch of unwatches) {
      unwatch();
    }

    unregisterRecentHandler();
    clearInterval(relativeAgeTimer);
    popupPort.disconnect();
  };
}
