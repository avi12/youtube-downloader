import {
  handleEmbedMetadata,
  handleMuxVideoAudio,
  handleTranscodeAudio,
  handleTranscodeFile
} from "./mux-job-handlers";
import {
  initFfmpeg,
  initPortReceiver,
  postError,
  reportFFmpegProgress,
  state
} from "./mux-state";
import type { FFmpegFactory } from "./mux-state";
import { WorkerMessageType } from "@/lib/download-pipeline/mux-worker-types";

type InitMessage = {
  type: WorkerMessageType.Init;
  wasmBinary: ArrayBuffer;
  port: MessagePort;
};

async function onInitMessage(e: MessageEvent<InitMessage>) {
  if (e.data?.type !== WorkerMessageType.Init) {
    return;
  }

  removeEventListener("message", onInitMessage);
  initPortReceiver(e.data.port);

  // @ts-expect-error @ffmpeg/core ships no .d.ts; we type it via @ffmpeg/types
  const { default: createFFmpegCoreUntyped } = await import("@ffmpeg/core");
  const createFFmpegCore: FFmpegFactory = createFFmpegCoreUntyped;
  initFfmpeg(await createFFmpegCore({ wasmBinary: e.data.wasmBinary }));
  state.ffmpeg!.setLogger(({ type, message }) => {
    if (type === "stderr") {
      console.error("[ytdl:ffmpeg]", message);
    }
  });
  state.ffmpeg!.setProgress(({ progress }) => {
    if (progress < 0) {
      return;
    }

    reportFFmpegProgress(state.progressOffset + progress * state.progressScale);
  });

  state.portReceiver!.onMessage({
    [WorkerMessageType.MuxVideoAudio]({ job }) {
      try {
        handleMuxVideoAudio(job);
      } catch (error) {
        postError(error instanceof Error ? error.message : String(error));
      }
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
      try {
        handleTranscodeFile(job);
      } catch (error) {
        postError(error instanceof Error ? error.message : String(error));
      }
    }
  });

  state.portReceiver!.sendReady();
}

export default defineUnlistedScript(() => {
  addEventListener("message", onInitMessage);
});
