import { initialOptions } from "./video-helpers";
import type { InterruptedDownload, Options, ProgressType, VideoQueueItem } from "@/types";

export const videoQueueItem = storage.defineItem<VideoQueueItem[]>("local:videoQueue", { fallback: [] });

export const musicListItem = storage.defineItem<string[]>("local:musicList", { fallback: [] });

export const videoOnlyListItem = storage.defineItem<string[]>("local:videoOnlyList", { fallback: [] });

export const videoDetailsItem = storage.defineItem<Record<string, {
  filenameOutput: string;
}>>("local:videoDetails", { fallback: {} });

export const statusProgressItem = storage.defineItem<Record<string, {
  progress: number;
  progressType: ProgressType;
}>>("local:statusProgress", { fallback: {} });

export const isFFmpegReadyItem = storage.defineItem<boolean>("local:isFFmpegReady", { fallback: false });

export const interruptedDownloadsItem = storage.defineItem<Record<string, InterruptedDownload>>("local:interruptedDownloads", { fallback: {} });

export const optionsItem = storage.defineItem<Options>("sync:options", { fallback: initialOptions });

export async function setOption<Key extends keyof Options>(
  key: Key,
  value: Options[Key]
) {
  const current = await optionsItem.getValue();
  current[key] = value;
  await optionsItem.setValue(current);
}

export async function clearLocalStorage() {
  await browser.storage.local.clear();
}
