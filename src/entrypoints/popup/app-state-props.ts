import type { Options, ProgressType, VideoQueueItem } from "@/types";

export interface InitialAppStateProps {
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
