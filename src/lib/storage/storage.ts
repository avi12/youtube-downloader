import { INITIAL_OPTIONS } from "@/lib/youtube/video-helpers";
import type { DownloadProgressEntry, InterruptedDownload, Options } from "@/types";

interface StorageItem<T> {
  getValue(): Promise<T>;
  setValue(value: T): Promise<void>;
}

export async function mutateStorageItem<T>({ item, mutator }: {
  item: StorageItem<T>;
  mutator: (current: T) => void;
}) {
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

export type VideoDetail = {
  filenameOutput: string;
  quality?: string;
  tabId?: number;
  playlistId?: string;
  playlistTitle?: string;
};

export const videoDetailsItem = storage.defineItem<Record<string, VideoDetail>>("local:videoDetails", {
  fallback: {}
});

export const statusProgressItem = storage.defineItem<Record<string, DownloadProgressEntry>>(
  "local:statusProgress",
  {
    fallback: {}
  }
);

export const isFFmpegReadyItem = storage.defineItem<boolean>("session:isFFmpegReady", { fallback: false });

export const interruptedDownloadsItem = storage.defineItem<Record<string, InterruptedDownload>>("local:interruptedDownloads", {
  fallback: {}
});

export const optionsItem = storage.defineItem<Options>("local:options", { fallback: INITIAL_OPTIONS });

export async function setOption<Key extends keyof Options>({ key, value }: {
  key: Key;
  value: Options[Key];
}) {
  await mutateStorageItem({
    item: optionsItem,
    mutator(current) {
      current[key] = value;
    }
  });
}

export async function clearLocalStorage() {
  await browser.storage.local.clear();
}
