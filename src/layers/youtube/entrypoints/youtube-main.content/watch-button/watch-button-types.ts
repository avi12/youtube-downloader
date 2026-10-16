import { ProgressType } from "@/types";
import type { Prettify } from "@/types";

export type ButtonViewState = Prettify<{
  isDownloading: boolean;
  isDone: boolean;
  isInterrupted: boolean;
  isError: boolean;
  isUnavailable: boolean;
  isPanelOpen: boolean;
  isPanelBelow: boolean;
  downloadProgress: string;
  isProgressNonZero: boolean;
  progressType: ProgressType | "";
  filename: string;
  quality: string;
  isDownloadable: boolean;
}>;

export const percentFormatter = new Intl.NumberFormat(document.documentElement.lang, {
  style: "percent",
  maximumFractionDigits: 0
});

export const WatchButtonLayout = {
  Watch: "watch",
  Shorts: "shorts"
} as const;

export type WatchButtonLayout = (typeof WatchButtonLayout)[keyof typeof WatchButtonLayout];
