import { DownloadType, ProgressType } from "@/types";

export interface ButtonState {
  isDownloading: boolean;
  isDone: boolean;
  isInterrupted: boolean;
  isError: boolean;
  isPanelOpen: boolean;
  downloadProgress: number;
  downloadProgressType: ProgressType | "";
  defaultVideoItag: number;
  defaultAudioItag: number;
  defaultFilename: string;
  defaultQuality: string;
  defaultDownloadType: DownloadType;
  lastProgressReported: number;
  lastRenderedButtonKey: string;
  lastRenderedChevronKey: string;
}
