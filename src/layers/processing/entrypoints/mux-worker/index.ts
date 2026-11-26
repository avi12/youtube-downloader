import { required } from "@/lib/required";
import { handleEmbedMetadata } from "./mux-handler-embed-metadata";
import { handleMuxVideoAudio } from "./mux-handler-mux-video-audio";
import { handleTranscodeAudio, handleTranscodeFile } from "./mux-handler-transcode";
import {
  initFfmpeg,
  initPortReceiver,
  postError,
  state,
  trackFFmpegProgressFromLog
} from "./mux-state";
import type { FFmpegFactory } from "./mux-state";
import { FFmpegCoreBuild, WorkerMessageType } from "@/lib/download-pipeline/mux-worker-types";
import { createLogger, LogScope } from "@/lib/utils/logger";
import { z } from "@/lib/zod";
import { createLazyGuard } from "@/lib/zod-guard";

const log = createLogger(LogScope.Ffmpeg);

const FFMPEG_LOG_TYPE_STDERR = "stderr";

const isInitMessage = createLazyGuard(() => z.object({
  type: z.literal(WorkerMessageType.Init),
  coreBuild: z.enum(FFmpegCoreBuild),
  wasmBinary: z.instanceof(ArrayBuffer),
  port: z.instanceof(MessagePort)
}));

const FFMPEG_CORE_GLUE: Record<FFmpegCoreBuild, () => Promise<{ default: FFmpegFactory }>> = {
  // @ts-expect-error @ffmpeg/core ships no .d.ts
  [FFmpegCoreBuild.Simd]: () => import("@ffmpeg/core"),
  // @ts-expect-error @ffmpeg/core ships no .d.ts
  [FFmpegCoreBuild.NoSimd]: () => import("@ffmpeg/core-nosimd")
};

async function onInitMessage(event: MessageEvent<unknown>) {
  const message = event.data;
  if (!isInitMessage(message)) {
    return;
  }

  removeEventListener("message", onInitMessage);
  initPortReceiver(message.port);

  const { default: createFFmpegCore } = await FFMPEG_CORE_GLUE[message.coreBuild]();
  const ffmpeg = await createFFmpegCore({ wasmBinary: message.wasmBinary }).catch((error: unknown) => {
    postError(error instanceof Error ? error.message : String(error));
    return null;
  });
  if (!ffmpeg) {
    return;
  }

  initFfmpeg(ffmpeg);
  required(state.ffmpeg).setLogger(({ type, message }) => {
    const isStderr = type === FFMPEG_LOG_TYPE_STDERR;
    if (!isStderr) {
      return;
    }

    // debug, not error: ffmpeg writes ALL output (banner, per-frame progress,
    // summary) to stderr, which would otherwise flood the chrome://extensions
    // error panel. Genuine mux failures still surface via postError.
    log.debug(message);
    trackFFmpegProgressFromLog(message);
  });

  required(state.portReceiver).onMessage({
    [WorkerMessageType.MuxVideoAudio]({ job }) {
      handleMuxVideoAudio(job).catch(error => {
        postError(error instanceof Error ? error.message : String(error));
      });
    },
    [WorkerMessageType.EmbedMetadata]({ job }) {
      handleEmbedMetadata(job).catch(error => {
        postError(error instanceof Error ? error.message : String(error));
      });
    },
    [WorkerMessageType.TranscodeAudio]({ job }) {
      try {
        handleTranscodeAudio(job);
      } catch (error) {
        postError(error instanceof Error ? error.message : String(error));
      }
    },
    [WorkerMessageType.TranscodeFile]({ job }) {
      handleTranscodeFile(job).catch(error => {
        postError(error instanceof Error ? error.message : String(error));
      });
    }
  });

  required(state.portReceiver).sendReady();
}

export default defineUnlistedScript(() => {
  addEventListener("message", onInitMessage);
});
