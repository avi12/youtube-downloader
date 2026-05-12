import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { interruptedDownloadStore } from "@/lib/ui/synced-stores.svelte";

export async function checkInterruptedDownload(videoId: string) {
  const interruptedDownload = await sendMessage(MessageType.GetInterruptedDownload, { videoId });
  if (!interruptedDownload) {
    interruptedDownloadStore.delete(videoId);
    return;
  }

  interruptedDownloadStore.set(videoId, interruptedDownload);
}
