import { WorkerMessageType } from "@/lib/download-pipeline/mux-worker-types";
import { createWorkerPortReceiver } from "@/lib/download-pipeline/worker-port-receiver";
import type { WorkerPortReceiver } from "@/lib/download-pipeline/worker-port-receiver";
import { ProgressType } from "@/types";
import type { Prettify } from "@/types";
import type { FFmpegCoreModule } from "@ffmpeg/types";

export type FFmpegFactory = (options: { wasmBinary: ArrayBuffer }) => Promise<FFmpegCoreModule>;

type MuxState = Prettify<{
  ffmpeg: FFmpegCoreModule | null;
  portReceiver: WorkerPortReceiver | null;
  progressOffset: number;
  progressScale: number;
  currentVideoId: string;
  currentTabId: number;
}>;

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

function reportFFmpegProgress(value: number) {
  state.portReceiver?.send(WorkerMessageType.Progress, {
    videoId: state.currentVideoId,
    progress: Math.max(0, Math.min(value, 0.99)),
    progressType: ProgressType.FFmpeg,
    tabId: state.currentTabId
  });
}

// @ffmpeg/core's setProgress callback does not fire in this build, so mux
// progress is derived from the stderr the logger does emit: `Duration:` gives
// the pass length and `time=` the position within it.
const PROGRESS_REPORT_DELTA = 0.01;
let muxDurationSec = 0;
let lastReportedProgress = -1;

function parseTimecodeSeconds(timecode: string) {
  const [hours, minutes, seconds] = timecode.split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

function updateMuxDuration(message: string) {
  if (message.includes("Input #0")) {
    muxDurationSec = 0;
    lastReportedProgress = -1;
    return true;
  }

  const durationTimecode = message.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/)?.[1];
  if (durationTimecode) {
    muxDurationSec = Math.max(muxDurationSec, parseTimecodeSeconds(durationTimecode));
    return true;
  }

  return false;
}

function reportLogProgress(timeTimecode: string) {
  if (muxDurationSec <= 0) {
    return;
  }

  const passProgress = Math.min(parseTimecodeSeconds(timeTimecode) / muxDurationSec, 1);
  const value = state.progressOffset + passProgress * state.progressScale;
  if (value - lastReportedProgress < PROGRESS_REPORT_DELTA) {
    return;
  }

  lastReportedProgress = value;
  reportFFmpegProgress(value);
}

export function trackFFmpegProgressFromLog(message: string) {
  if (updateMuxDuration(message)) {
    return;
  }

  const timeTimecode = message.match(/\btime=\s*(\d+:\d+:\d+(?:\.\d+)?)/)?.[1];
  if (timeTimecode) {
    reportLogProgress(timeTimecode);
  }
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
