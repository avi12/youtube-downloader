import { fetchFFmpegCoreWasm } from "./ffmpeg-wasm-source";
import { registerOffscreenMessageListeners } from "./offscreen-message-listeners";
import { handleWorkerMessage, WORKER_MESSAGE_PREFIX, type WorkerMessage } from "./worker-message-handler";
import { resolveFFmpegCoreBuild } from "@/lib/download-pipeline/ffmpeg-core-build";
import { initMuxWorker } from "@/lib/download-pipeline/ffmpeg-instance";
import { sweepOrphanedOpfsFiles } from "@/lib/download-pipeline/opfs-constants";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { createLogger, LogScope } from "@/lib/utils/logger";

const log = createLogger(LogScope.Ffmpeg);

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

async function loadFFmpegCore() {
  const coreBuild = resolveFFmpegCoreBuild();
  await initMuxWorker({
    coreBuild,
    wasmBinary: await fetchFFmpegCoreWasm(coreBuild)
  });
}

await loadFFmpegCore().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log.error("FFmpeg failed to load:", message);
  await sendMessage(MessageType.PipelineFFmpegFailed, { message });
});
