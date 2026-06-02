import { registerOffscreenMessageListeners } from "./offscreen-message-listeners";
import { WORKER_MSG_PREFIX, handleWorkerMessage, type WorkerMessage } from "./worker-message-handler";
import { initMuxWorker } from "@/lib/download-pipeline/ffmpeg-instance";
import { browser } from "#imports";

const FFMPEG_WASM_PATH = "/ffmpeg/ffmpeg-core.wasm";

addEventListener("message", e => {
  const isExternalOrigin = e.origin !== location.origin;
  if (isExternalOrigin) {
    return;
  }

  const message: WorkerMessage = e.data;
  const isWorkerMessage = message?.type?.startsWith(WORKER_MSG_PREFIX);
  if (!isWorkerMessage) {
    return;
  }

  handleWorkerMessage(message);
});

registerOffscreenMessageListeners();

const wasmBinary = await (await fetch(
  browser.runtime.getURL(FFMPEG_WASM_PATH)
)).arrayBuffer();
await initMuxWorker(wasmBinary);
