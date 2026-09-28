import type {
  DownloadProgressEntry,
  Options,
  Prettify,
  VideoDetail,
  VideoQueueItem
} from "@/types";

export type InitialAppStateProps = Prettify<{
  initialIsFFmpegReady: boolean;
  initialVideoQueue: VideoQueueItem[];
  initialMusicList: string[];
  initialVideoOnlyList: string[];
  initialVideoDetails: Record<string, VideoDetail>;
  initialStatusProgress: Record<string, DownloadProgressEntry>;
  initialCurrentTabId?: number;
  initialCurrentSourceUrl?: string;
  initialOptions: Options;
}>;
