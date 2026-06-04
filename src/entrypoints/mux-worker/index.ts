import { handleEmbedMetadata } from "./mux-handler-embed-metadata";
import { handleMuxVideoAudio } from "./mux-handler-mux-video-audio";
import { handleTranscodeAudio, handleTranscodeFile } from "./mux-handler-transcode";
import {
  initFfmpeg,
  initPortReceiver,
  postError,
  reportFFmpegProgress,
  state
} from "./mux-state";
import type { FFmpegFactory } from "./mux-state";
import { WorkerMessageType } from "@/lib/download-pipeline/mux-worker-types";
import type { Prettify } from "@/types";

const FFMPEG_LOG_TYPE_STDERR = "stderr";

type InitMessage = Prettify<{
  type: WorkerMessageType.Init;
  wasmBinary: ArrayBuffer;
  port: MessagePort;
}>;

async function onInitMessage(e: MessageEvent<InitMessage>) {
  if (e.data?.type !== WorkerMessageType.Init) {
    return;
  }

  removeEventListener("message", onInitMessage);
  initPortReceiver(e.data.port);

  // @ts-expect-error @ffmpeg/core ships no .d.ts
  const { default: createFFmpegCoreUntyped } = await import("@ffmpeg/core");
  const createFFmpegCore: FFmpegFactory = createFFmpegCoreUntyped;
  initFfmpeg(await createFFmpegCore({ wasmBinary: e.data.wasmBinary }));
  state.ffmpeg!.setLogger(({ type, message }) => {
    const isStderr = type === FFMPEG_LOG_TYPE_STDERR;
    if (isStderr) {
      console.error("[ytdl:ffmpeg]", message);
    }
  });
  state.ffmpeg!.setProgress(({ progress }) => {
    const isInvalidProgress = progress < 0;
    if (isInvalidProgress) {
      return;
    }

    reportFFmpegProgress(state.progressOffset + progress * state.progressScale);
  });

  state.portReceiver!.onMessage({
    [WorkerMessageType.MuxVideoAudio]({ job }) {
      void handleMuxVideoAudio(job).catch(error => {
        postError(error instanceof Error ? error.message : String(error));
      });
    },
    [WorkerMessageType.EmbedMetadata]({ job }) {
      void handleEmbedMetadata(job).catch(error => {
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
      void handleTranscodeFile(job).catch(error => {
        postError(error instanceof Error ? error.message : String(error));
      });
    }
  });

  state.portReceiver!.sendReady();
}

export default defineUnlistedScript(() => {
  addEventListener("message", onInitMessage);
});
