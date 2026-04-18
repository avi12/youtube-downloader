import type { InterruptedDownload, Options, ProgressType } from "@/types";
import { initialOptions } from "~/lib/youtube/video-helpers";

interface StorageItem<T> {
  getValue(): Promise<T>;
  setValue(value: T): Promise<void>;
}

export async function mutateStorageItem<T>(item: StorageItem<T>, mutator: (current: T) => void) {
  const current = await item.getValue();
  mutator(current);
  await item.setValue(current);
}

export const videoQueueItem = storage.defineItem<{
  videoId: string;
  filenameOutput: string;
}[]>("local:videoQueue", { fallback: [] });

export type VideoQueueItem = Parameters<typeof videoQueueItem.setValue>[0][number];

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

export async function setOption<Key extends keyof Options>(key: Key, value: Options[Key]) {
  await mutateStorageItem(optionsItem, current => {
    current[key] = value;
  });
}

export async function clearLocalStorage() {
  await browser.storage.local.clear();
}
