import { FFmpegWorkerClient } from "./ffmpeg-worker-client";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";

let workerClient: FFmpegWorkerClient | null = null;
export const progressHandlers = new Set<(progress: { progress: number }) => void>();

const READY_RETRY_INTERVAL_MS = 3_000;
const READY_MAX_RETRIES = 30;

async function signalReadyWithRetry() {
  for (let i = 0; i < READY_MAX_RETRIES; i++) {
    try {
      await sendMessage(MessageType.PipelineFFmpegReady, {});
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, READY_RETRY_INTERVAL_MS));
    }
  }
}

export function initFFmpeg(client: FFmpegWorkerClient) {
  workerClient = client;
  client.onProgress(progress => {
    for (const handler of progressHandlers) {
      handler(progress);
    }
  });
  client.onLog(({ type, message }) => {
    if (type !== "stderr") {
      return;
    }

    const trimmed = message.trim();
    if (!trimmed) {
      return;
    }

    // These two warnings flood thousands of times per mux and make the YouTube tab unresponsive.
    if (trimmed.includes("Non-monotonous DTS") || trimmed.includes("backward in time")) {
      return;
    }

    void broadcastDebugLogToYouTubeTabs(`[ytdl:ffmpeg-stderr] ${trimmed}`);
  });
  void signalReadyWithRetry();
}

export function getFFmpeg() {
  if (!workerClient) {
    throw new Error("initFFmpeg() must be called before processing downloads");
  }

  return workerClient;
}

export function tryUnlink(filename: string) {
  getFFmpeg().FS.unlink(filename);
}

const muxQueue: (() => Promise<void>)[] = [];
let isMuxing = false;

async function processMuxQueue() {
  if (isMuxing) {
    return;
  }

  isMuxing = true;

  while (muxQueue.length > 0) {
    const job = muxQueue.shift();
    if (!job) {
      break;
    }

    await job();
  }

  isMuxing = false;
}

export async function enqueueMuxJob(job: () => Promise<void>) {
  return new Promise<void>((resolve, reject) => {
    muxQueue.push(async () => {
      try {
        await job();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    void processMuxQueue();
  });
}
