/**
 * Manages interrupted download state persistence between the MAIN world
 * and background storage, using the synced signal store for cross-world
 * communication.
 */

import { MessageType, sendMessage } from "@/lib/messaging";
import { interruptedDownloadStore } from "@/lib/synced-stores.svelte";

export async function checkInterruptedDownload(videoId: string) {
  const interruptedDownload = await sendMessage(MessageType.GetInterruptedDownload, { videoId });
  if (!interruptedDownload) {
    interruptedDownloadStore.delete(videoId);
    return;
  }

  interruptedDownloadStore.set(videoId, interruptedDownload);
}

export function listenForInterruptedDownloadEvents() {
  document.addEventListener("ytdl:persist-interrupted", async e => {
    if (!(e instanceof CustomEvent)) {
      return;
    }

    await sendMessage(MessageType.PersistInterruptedDownload, e.detail);
    interruptedDownloadStore.set(e.detail.videoId, e.detail);
  });

  document.addEventListener("ytdl:clear-interrupted", async e => {
    if (!(e instanceof CustomEvent)) {
      return;
    }

    await sendMessage(MessageType.ClearInterruptedDownload, { videoId: e.detail.videoId });
    interruptedDownloadStore.delete(e.detail.videoId);
  });
}
