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

    const isJobCancelled = cancelledMuxJobs.has(entry.videoId);
    if (isJobCancelled) {
      cancelledMuxJobs.delete(entry.videoId);
      entry.reject(new Error("muxJobCancelled"));
      continue;
    }

    await entry.run();
  }

  isMuxing = false;
}

export function enqueueMuxJob<T>({ videoId, run }: {
  videoId: string;
  run: () => Promise<T>;
}) {
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
      entry.reject(new Error("muxJobCancelled"));
    }
  }
}
