import type { EmbedMetadataJob, MuxVideoAudioJob, TranscodeAudioJob, TranscodeFileJob } from "./mux-worker-types";
import { WorkerMessageType } from "./mux-worker-types";
import { createHostWorkerPort } from "./worker-port";
import type { HostWorkerPort } from "./worker-port";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

let workerPort: HostWorkerPort | null = null;
let pendingJobReject: ((e: Error) => void) | null = null;

export function initMuxWorker(wasmBinary: ArrayBuffer) {
  const hostPort = createHostWorkerPort();
  workerPort = hostPort;

  return new Promise<void>((resolve, reject) => {
    hostPort.onMessage({
      [WorkerMessageType.Ready]() {
        resolve();
      },
      [WorkerMessageType.Error]({ message }) {
        reject(new Error(message));
      }
    });

    const worker = new Worker(browser.runtime.getURL("/mux-worker.js"), { type: "module" });
    worker.onerror = e => {
      const error = new Error(`Worker crashed: ${e.message}`);
      const rejectJob = pendingJobReject;
      pendingJobReject = null;

      if (rejectJob) {
        rejectJob(error);
      } else {
        reject(error);
      }
    };
    worker.postMessage({
      type: WorkerMessageType.Init,
      wasmBinary,
      port: hostPort.port
    }, [wasmBinary, hostPort.port]);
  }).then(() => {
    void sendMessage(MessageType.PipelineFFmpegReady, {});
  });
}

// ---------------------------------------------------------------------------
// Serialization queue (one FFmpeg job at a time)
// ---------------------------------------------------------------------------

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

function enqueueMuxJob<T>(videoId: string, run: () => Promise<T>): Promise<T> {
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

// Drop pending jobs for these videoIds. Currently-running jobs cannot be
// interrupted (ffmpeg.exec is synchronous inside the worker), but in practice
// cancel typically fires while SABR is still fetching — long before the mux phase begins.
export function cancelMuxJobs(videoIds: string[]) {
  const videoIdSet = new Set(videoIds);
  for (const videoId of videoIds) {
    cancelledMuxJobs.add(videoId);
  }

  for (let iEntry = muxQueue.length - 1; iEntry >= 0; iEntry--) {
    const entry = muxQueue[iEntry];
    if (videoIdSet.has(entry.videoId)) {
      muxQueue.splice(iEntry, 1);
      cancelledMuxJobs.delete(entry.videoId);
      entry.reject(new Error("muxJobCancelled"));
    }
  }
}

// ---------------------------------------------------------------------------
// Worker round-trip helper (using typed port)
// ---------------------------------------------------------------------------

function runWorkerJob<T>(
  send: (port: HostWorkerPort) => void,
  transform: (data: ArrayBuffer | null) => T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!workerPort) {
      reject(new Error("Mux worker not initialized"));
      return;
    }

    pendingJobReject = reject;

    workerPort.onMessage({
      [WorkerMessageType.Result]({ data }) {
        pendingJobReject = null;
        resolve(transform(data));
      },
      [WorkerMessageType.Error]({ message }) {
        pendingJobReject = null;
        reject(new Error(message));
      },
      [WorkerMessageType.Progress]({ videoId, progress, progressType, tabId }) {
        void sendMessage(MessageType.PipelineProgress, {
          videoId,
          progress,
          progressType,
          tabId
        });
      }
    });

    send(workerPort);
  });
}

// ---------------------------------------------------------------------------
// Public job APIs
// ---------------------------------------------------------------------------

export function runMuxVideoAudio(
  videoId: string,
  job: MuxVideoAudioJob
): Promise<Uint8Array> {
  const transferables: Transferable[] = [job.videoData, job.audioData];
  for (const track of job.extraAudioTracks) {
    transferables.push(track.data);
  }

  return enqueueMuxJob(videoId, () =>
    runWorkerJob<Uint8Array>(
      port => port.send(WorkerMessageType.MuxVideoAudio, { job }, transferables),
      data => {
        if (!data) {
          throw new Error("Worker returned no data for muxVideoAudio");
        }

        return new Uint8Array(data);
      }
    ));
}

export function runEmbedMetadata(
  videoId: string,
  job: EmbedMetadataJob
): Promise<Uint8Array> {
  return enqueueMuxJob(videoId, () =>
    runWorkerJob<Uint8Array>(
      port => port.send(WorkerMessageType.EmbedMetadata, { job }, [job.audioData]),
      data => new Uint8Array(data ?? new ArrayBuffer(0))
    ));
}

export function runTranscodeAudio(
  videoId: string,
  job: TranscodeAudioJob
): Promise<Uint8Array> {
  return enqueueMuxJob(videoId, () =>
    runWorkerJob<Uint8Array>(
      port => port.send(WorkerMessageType.TranscodeAudio, { job }, [job.audioData]),
      data => {
        if (!data) {
          throw new Error("Worker returned no data for transcodeAudio");
        }

        return new Uint8Array(data);
      }
    ));
}

export function runTranscodeFile(
  videoId: string,
  job: TranscodeFileJob
): Promise<Uint8Array | null> {
  return enqueueMuxJob(videoId, () =>
    runWorkerJob<Uint8Array | null>(
      port => port.send(WorkerMessageType.TranscodeFile, { job }, [job.data]),
      data => data ? new Uint8Array(data) : null
    ));
}
