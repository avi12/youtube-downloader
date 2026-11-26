import { fetchFFmpegCoreWasm } from "./ffmpeg-wasm-source";
import { registerOffscreenMessageListeners } from "./offscreen-message-listeners";
import { handleWorkerMessage } from "./worker-message-handler";
import { isWorkerMessage } from "@/layers/processing/worker-frame-messages";
import { resolveFFmpegCoreBuild } from "@/lib/download-pipeline/ffmpeg-core-build";
import { initMuxWorker } from "@/lib/download-pipeline/ffmpeg-instance";
import { sweepOrphanedOpfsFiles } from "@/lib/download-pipeline/opfs-constants";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { createLogger, LogScope } from "@/lib/utils/logger";

const log = createLogger(LogScope.Ffmpeg);

addEventListener("message", event => {
  const isExternalOrigin = event.origin !== location.origin;
  if (isExternalOrigin) {
    return;
  }

  const message: unknown = event.data;
  if (!isWorkerMessage(message)) {
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
