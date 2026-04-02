/**
 * Manages interrupted download state persistence between the MAIN world
 * and background storage, using the synced signal store for cross-world
 * communication.
 */

import { sendMessage } from "@/lib/messaging";
import { interruptedDownloadStore } from "@/lib/synced-stores";

export async function checkInterruptedDownload(videoId: string) {
  const interrupted = await sendMessage("getInterruptedDownload", { videoId });
  if (interrupted) {
    interruptedDownloadStore.set(videoId, interrupted);
  } else {
    interruptedDownloadStore.delete(videoId);
  }
}

export function listenForInterruptedDownloadEvents() {
  document.addEventListener("ytdl:persist-interrupted", async e => {
    if (!(e instanceof CustomEvent)) {
      return;
    }

    await sendMessage("persistInterruptedDownload", e.detail);
    interruptedDownloadStore.set(e.detail.videoId, e.detail);
  });

  document.addEventListener("ytdl:clear-interrupted", async e => {
    if (!(e instanceof CustomEvent)) {
      return;
    }

    await sendMessage("clearInterruptedDownload", { videoId: e.detail.videoId });
    interruptedDownloadStore.delete(e.detail.videoId);
  });
}
