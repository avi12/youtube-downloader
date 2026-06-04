import type { Prettify } from "@/types";

export const MUX_JOB_CANCELLED_ERROR = "muxJobCancelled";

type MuxQueueEntry = Prettify<{
  videoId: string;
  run: () => Promise<void>;
  reject: (reason: Error) => void;
}>;

const muxQueue: MuxQueueEntry[] = [];
const cancelledMuxJobs = new Set<string>();
let isMuxing = false;

async function processMuxQueue() {
  if (isMuxing) {
    return;
  }

  isMuxing = true;

  while (muxQueue.length > 0) {
    const batch = muxQueue.splice(0);
    for (const entry of batch) {
      const isJobCancelled = cancelledMuxJobs.has(entry.videoId);
      if (isJobCancelled) {
        cancelledMuxJobs.delete(entry.videoId);
        entry.reject(new Error(MUX_JOB_CANCELLED_ERROR));
        continue;
      }

      await entry.run();
    }
  }

  isMuxing = false;
}

export function enqueueMuxJob<T>({ videoId, run }: {
  videoId: string;
  run: () => Promise<T>;
}) {
  // A fresh enqueue for this videoId supersedes any stale cancel marker. Without
  // this, the next time the queue drains after a cancel-then-restart, the new
  // entry would be silently rejected with MUX_JOB_CANCELLED_ERROR.
  cancelledMuxJobs.delete(videoId);
  return new Promise<T>((resolve, reject) => {
    muxQueue.push({
      videoId,
      reject,
      async run() {
        try {
          resolve(await run());
        } catch (error) {
          reject(error);
        }
      }
    });
    void processMuxQueue();
  });
}

export function cancelMuxJobs(videoIds: string[]) {
  const videoIdSet = new Set(videoIds);
  for (const videoId of videoIds) {
    cancelledMuxJobs.add(videoId);
  }

  for (let iEntry = muxQueue.length - 1; iEntry >= 0; iEntry--) {
    const entry = muxQueue[iEntry];
    const isEntryInSet = videoIdSet.has(entry.videoId);
    if (isEntryInSet) {
      muxQueue.splice(iEntry, 1);
      cancelledMuxJobs.delete(entry.videoId);
      entry.reject(new Error(MUX_JOB_CANCELLED_ERROR));
    }
  }
}
