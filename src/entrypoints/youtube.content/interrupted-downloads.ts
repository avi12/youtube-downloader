/**
 * Manages interrupted download state persistence between the MAIN world
 * and background storage, using DOM elements for cross-world communication.
 */

import { sendMessage } from "@/lib/messaging";

export async function checkInterruptedDownload(videoId: string) {
  const interrupted = await sendMessage("getInterruptedDownload", { videoId });
  let elInterrupted = document.getElementById("ytdl-interrupted");
  if (!interrupted) {
    elInterrupted?.remove();
    return;
  }

  if (!elInterrupted) {
    elInterrupted = document.createElement("div");
    elInterrupted.id = "ytdl-interrupted";
    elInterrupted.hidden = true;
    document.documentElement.append(elInterrupted);
  }

  elInterrupted.dataset.videoId = interrupted.videoId;
  elInterrupted.dataset.type = interrupted.type;
  elInterrupted.dataset.filenameOutput = interrupted.filenameOutput;
  elInterrupted.dataset.videoItag = String(interrupted.videoItag);
  elInterrupted.dataset.audioItag = String(interrupted.audioItag);
}

export function listenForInterruptedDownloadEvents() {
  document.addEventListener("ytdl:persist-interrupted", async (e: Event) => {
    if (!(e instanceof CustomEvent)) {
      return;
    }

    await sendMessage("persistInterruptedDownload", e.detail);
  });

  document.addEventListener("ytdl:clear-interrupted", async (e: Event) => {
    if (!(e instanceof CustomEvent)) {
      return;
    }

    await sendMessage("clearInterruptedDownload", { videoId: e.detail.videoId });
  });
}
