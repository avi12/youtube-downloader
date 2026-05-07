import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { FFmpegCoreModule, Progress } from "@ffmpeg/types";

let sharedFFmpeg: FFmpegCoreModule | null = null;
export const progressHandlers = new Set<(progress: Progress) => void>();

export function initFFmpeg(core: FFmpegCoreModule) {
  sharedFFmpeg = core;
  core.setProgress(progress => {
    for (const handler of progressHandlers) {
      handler(progress);
    }
  });
  void sendMessage(MessageType.PipelineFFmpegReady, {});
}

export function getFFmpeg() {
  if (!sharedFFmpeg) {
    throw new Error("initFFmpeg() must be called before processing video+audio downloads");
  }

  return sharedFFmpeg;
}

export function tryUnlink({ ffmpeg, filename }: {
  ffmpeg: FFmpegCoreModule;
  filename: string;
}) {
  try {
    ffmpeg.FS.unlink(filename);
  } catch {
    // ffmpeg never wrote file
  }
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
