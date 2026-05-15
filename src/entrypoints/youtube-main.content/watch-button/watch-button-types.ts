import { ProgressType } from "@/types";

export interface ButtonViewState {
  isDownloading: boolean;
  isDone: boolean;
  isInterrupted: boolean;
  isError: boolean;
  isPanelOpen: boolean;
  isPanelBelow: boolean;
  downloadProgress: string;
  isProgressNonZero: boolean;
  progressType: ProgressType | "";
  filename: string;
  quality: string;
  isDownloadable: boolean;
}

export const percentFormatter = new Intl.NumberFormat(document.documentElement.lang, {
  style: "percent",
  maximumFractionDigits: 0
});
