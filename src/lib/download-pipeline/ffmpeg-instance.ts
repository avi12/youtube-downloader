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

interface MuxQueueEntry {
  videoId: string;
  run: () => Promise<void>;
  reject: (reason: Error) => void;
}

const muxQueue: MuxQueueEntry[] = [];
const cancelledMuxJobs = new Set<string>();
let isMuxing = false;

async function processMuxQueue() {
  if (isMuxing) {
    return;
  }

  isMuxing = true;

  while (muxQueue.length > 0) {
    const entry = muxQueue.shift();
    if (!entry) {
      break;
    }

    if (cancelledMuxJobs.has(entry.videoId)) {
      cancelledMuxJobs.delete(entry.videoId);
      entry.reject(new Error("muxJobCancelled"));
      continue;
    }

    await entry.run();
  }

  isMuxing = false;
}

export async function enqueueMuxJob({ videoId, job }: {
  videoId: string;
  job: () => Promise<void>;
}) {
  return new Promise<void>((resolve, reject) => {
    muxQueue.push({
      videoId,
      reject,
      async run() {
        try {
          await job();
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    });
    void processMuxQueue();
  });
}

// Drop pending jobs for these videoIds. Currently-running jobs cannot be
// interrupted (ffmpeg.exec is synchronous), but in practice cancel typically
// fires while SABR is still fetching — long before the mux phase begins.
export function cancelMuxJobs(videoIds: string[]) {
  const idsSet = new Set(videoIds);
  for (const videoId of videoIds) {
    cancelledMuxJobs.add(videoId);
  }

  for (let iEntry = muxQueue.length - 1; iEntry >= 0; iEntry--) {
    const entry = muxQueue[iEntry];
    if (idsSet.has(entry.videoId)) {
      muxQueue.splice(iEntry, 1);
      cancelledMuxJobs.delete(entry.videoId);
      entry.reject(new Error("muxJobCancelled"));
    }
  }
}
