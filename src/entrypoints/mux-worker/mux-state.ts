import { WorkerMessageType } from "@/lib/download-pipeline/mux-worker-types";
import { createWorkerPortReceiver } from "@/lib/download-pipeline/worker-port";
import type { WorkerPortReceiver } from "@/lib/download-pipeline/worker-port";
import { ProgressType } from "@/types";
import type { FFmpegCoreModule } from "@ffmpeg/types";

export type FFmpegFactory = (options: { wasmBinary: ArrayBuffer }) => Promise<FFmpegCoreModule>;

interface MuxState {
  ffmpeg: FFmpegCoreModule | null;
  portReceiver: WorkerPortReceiver | null;
  progressOffset: number;
  progressScale: number;
  currentVideoId: string;
  currentTabId: number;
}

export const state: MuxState = {
  ffmpeg: null,
  portReceiver: null,
  progressOffset: 0,
  progressScale: 1,
  currentVideoId: "",
  currentTabId: 0
};

export function initFfmpeg(instance: FFmpegCoreModule) {
  state.ffmpeg = instance;
}

export function initPortReceiver(port: MessagePort) {
  state.portReceiver = createWorkerPortReceiver(port);
}

export function tryUnlink(filename: string) {
  try {
    state.ffmpeg!.FS.unlink(filename);
  } catch {
    // file was never written
  }
}

export function reportFFmpegProgress(value: number) {
  state.portReceiver?.send(WorkerMessageType.Progress, {
    videoId: state.currentVideoId,
    progress: Math.max(0, Math.min(value, 0.99)),
    progressType: ProgressType.FFmpeg,
    tabId: state.currentTabId
  });
}

export function postResult(data: Uint8Array | null) {
  if (!data) {
    state.portReceiver!.send(WorkerMessageType.Result, { data: null });
    return;
  }

  if (!(data.buffer instanceof ArrayBuffer)) {
    state.portReceiver!.send(WorkerMessageType.Error, { message: "Unexpected SharedArrayBuffer in result" });
    return;
  }

  // FS.readFile returns an exactly-sized buffer (byteOffset=0, byteLength=buffer.byteLength),
  // so transfer it directly without a copy. The slice fallback handles any over-allocated edge cases.
  const { buffer } = data;
  const isExact = data.byteOffset === 0 && data.byteLength === buffer.byteLength;
  const exact = isExact ? buffer : buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  state.portReceiver!.send(WorkerMessageType.Result, { data: exact }, [exact]);
}

export function postFileResult(file: File) {
  state.portReceiver!.send(WorkerMessageType.ResultFile, { data: file });
}

export function postError(message: string) {
  state.portReceiver!.send(WorkerMessageType.Error, { message });
}
