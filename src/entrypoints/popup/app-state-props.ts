import type { DownloadProgressEntry, Options, VideoDetail, VideoQueueItem } from "@/types";

export interface InitialAppStateProps {
  initialIsFFmpegReady: boolean;
  initialVideoQueue: VideoQueueItem[];
  initialMusicList: string[];
  initialVideoOnlyList: string[];
  initialVideoDetails: Record<string, VideoDetail>;
  initialStatusProgress: Record<string, DownloadProgressEntry>;
  initialCurrentTabId?: number;
  initialCurrentSourceUrl?: string;
  initialOptions: Options;
}
