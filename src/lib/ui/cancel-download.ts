import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { statusProgressItem } from "@/lib/storage/storage";
import { downloadProgressStore, interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";

export async function performCancelDownload(videoIds: string[]) {
  for (const id of videoIds) {
    downloadProgressStore.delete(id);
    interruptedDownloadStore.delete(id);
  }

  void sendMessage(MessageType.CancelDownload, { videoIds });
  const currentProgress = await statusProgressItem.getValue();
  for (const id of videoIds) {
    if (!downloadProgressStore.get(id)?.isDownloading) {
      delete currentProgress[id];
    }
  }

  await statusProgressItem.setValue(currentProgress);
}
