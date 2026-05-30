import type { Options, ProgressType, VideoDetail, VideoQueueItem } from "@/types";

export interface InitialAppStateProps {
  initialIsFFmpegReady: boolean;
  initialVideoQueue: VideoQueueItem[];
  initialMusicList: string[];
  initialVideoOnlyList: string[];
  initialVideoDetails: Record<string, VideoDetail>;
  initialStatusProgress: Record<string, {
    progress: number;
    progressType: ProgressType;
  }>;
  initialCurrentTabId?: number;
  initialCurrentSourceUrl?: string;
  initialOptions: Options;
}
