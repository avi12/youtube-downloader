import { registerOffscreenMessageListeners } from "./offscreen-message-listeners";
import { handleWorkerMessage, WORKER_MESSAGE_PREFIX, type WorkerMessage } from "./worker-message-handler";
import { initMuxWorker } from "@/lib/download-pipeline/ffmpeg-instance";
import { sweepOrphanedOpfsFiles } from "@/lib/download-pipeline/opfs-constants";
import { browser } from "#imports";

addEventListener("message", e => {
  const isExternalOrigin = e.origin !== location.origin;
  if (isExternalOrigin) {
    return;
  }

  const message: WorkerMessage = e.data;
  const isWorkerMessage = message?.type?.startsWith(WORKER_MESSAGE_PREFIX);
  if (!isWorkerMessage) {
    return;
  }

  handleWorkerMessage(message);
});

registerOffscreenMessageListeners();

await sweepOrphanedOpfsFiles();

const wasmBinary = await (await fetch(
  browser.runtime.getURL("/ffmpeg/ffmpeg-core.wasm")
)).arrayBuffer();
await initMuxWorker(wasmBinary);
