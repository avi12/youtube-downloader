import { enqueueMuxJob } from "./mux-queue";
import type { EmbedMetadataJob, MuxVideoAudioJob, TranscodeAudioJob, TranscodeFileJob } from "./mux-worker-types";
import { WorkerMessageType } from "./mux-worker-types";
import type { HostWorkerPort } from "./worker-port";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";

let workerPort: HostWorkerPort | null = null;
let pendingJobReject: ((e: Error) => void) | null = null;

export function setWorkerPort(port: HostWorkerPort) {
  workerPort = port;
}

export function getPendingJobReject() {
  return pendingJobReject;
}

export function runWorkerJob<T>(
  send: (port: HostWorkerPort) => void,
  transform: (data: ArrayBuffer | null) => T
) {
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

export function runMuxVideoAudio(videoId: string, job: MuxVideoAudioJob) {
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

export function runEmbedMetadata(videoId: string, job: EmbedMetadataJob) {
  return enqueueMuxJob(videoId, () =>
    runWorkerJob<Uint8Array>(
      port => port.send(WorkerMessageType.EmbedMetadata, { job }, [job.audioData]),
      data => new Uint8Array(data ?? new ArrayBuffer(0))
    ));
}

export function runTranscodeAudio(videoId: string, job: TranscodeAudioJob) {
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

export function runTranscodeFile(videoId: string, job: TranscodeFileJob) {
  return enqueueMuxJob(videoId, () =>
    runWorkerJob<Uint8Array | null>(
      port => port.send(WorkerMessageType.TranscodeFile, { job }, [job.data]),
      data => data ? new Uint8Array(data) : null
    ));
}
