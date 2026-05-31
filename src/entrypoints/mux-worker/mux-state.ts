import { WorkerMessageType } from "@/lib/download-pipeline/mux-worker-types";
import { createWorkerPortReceiver } from "@/lib/download-pipeline/worker-port-receiver";
import type { WorkerPortReceiver } from "@/lib/download-pipeline/worker-port-receiver";
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
  } catch { /* no-op */ }
}

export function tryUnmount(path: string) {
  try {
    state.ffmpeg!.FS.unmount(path);
  } catch { /* no-op */ }
}

export function tryRmdir(path: string) {
  try {
    state.ffmpeg!.FS.rmdir(path);
  } catch { /* no-op */ }
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

  const buffer: ArrayBuffer = data.buffer;
  const isZeroOffset = data.byteOffset === 0;
  const isExactSize = data.byteLength === buffer.byteLength;
  const isExact = isZeroOffset && isExactSize;
  const exact: ArrayBuffer = isExact ? buffer : buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  state.portReceiver!.send(WorkerMessageType.Result, { data: exact }, [exact]);
}

export function postFileResult(file: File) {
  state.portReceiver!.send(WorkerMessageType.ResultFile, { data: file });
}

export function postError(message: string) {
  state.portReceiver!.send(WorkerMessageType.Error, { message });
}
