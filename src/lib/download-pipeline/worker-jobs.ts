import { enqueueMuxJob } from "./mux-queue";
import type { EmbedMetadataJob, MuxVideoAudioJob, TranscodeAudioJob, TranscodeFileJob } from "./mux-worker-types";
import { WorkerMessageType } from "./mux-worker-types";
import type { HostWorkerPort } from "./worker-port-host";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import type { Prettify } from "@/types";

let workerPort: HostWorkerPort | null = null;
let pendingJobReject: ((e: Error) => void) | null = null;

export function setWorkerPort(port: HostWorkerPort) {
  workerPort = port;
}

export function getPendingJobReject() {
  return pendingJobReject;
}

type RunWorkerJobParams<T> = {
  send: (port: HostWorkerPort) => void;
  transform: (data: ArrayBuffer | null) => T;
};
export function runWorkerJob<T>({
  send,
  transform
}: RunWorkerJobParams<T>) {
  return new Promise<T>((resolve, reject) => {
    const isWorkerMissing = !workerPort;
    if (isWorkerMissing) {
      reject(new Error("Mux worker not initialized"));
      return;
    }

    pendingJobReject = reject;

    workerPort!.onMessage({
      [WorkerMessageType.Result]({ data }) {
        pendingJobReject = null;
        resolve(transform(data));
      },
      [WorkerMessageType.Error]({ message }) {
        pendingJobReject = null;
        reject(new Error(message));
      },
      [WorkerMessageType.Progress]({ videoId, progress, progressType, tabId }) {
        sendMessage(MessageType.PipelineProgress, {
          videoId,
          progress,
          progressType,
          tabId
        }).catch(() => {});
      }
    });

    send(workerPort!);
  });
}

type RunMuxVideoAudioParams = Prettify<{
  videoId: string;
  job: MuxVideoAudioJob;
}>;
export function runMuxVideoAudio({ videoId, job }: RunMuxVideoAudioParams) {
  const transferables: Transferable[] = [];
  const hasVideoData = Boolean(job.videoData);
  if (hasVideoData) {
    transferables.push(job.videoData!);
  }

  for (const track of job.audioTracks) {
    transferables.push(track.data);
  }

  return enqueueMuxJob({
    videoId,
    run: () =>
      new Promise<File>((resolve, reject) => {
        const isWorkerMissing = !workerPort;
        if (isWorkerMissing) {
          reject(new Error("Mux worker not initialized"));
          return;
        }

        pendingJobReject = reject;

        workerPort!.onMessage({
          [WorkerMessageType.ResultFile]({ data }) {
            pendingJobReject = null;
            resolve(data);
          },
          [WorkerMessageType.Error]({ message }) {
            pendingJobReject = null;
            reject(new Error(message));
          },
          [WorkerMessageType.Progress]({ videoId: progressVideoId, progress, progressType, tabId }) {
            sendMessage(MessageType.PipelineProgress, {
              videoId: progressVideoId,
              progress,
              progressType,
              tabId
            }).catch(() => {});
          }
        });

        workerPort!.send(WorkerMessageType.MuxVideoAudio, { job }, transferables);
      })
  });
}

type RunEmbedMetadataParams = Prettify<{
  videoId: string;
  job: EmbedMetadataJob;
}>;
export function runEmbedMetadata({ videoId, job }: RunEmbedMetadataParams) {
  return enqueueMuxJob({
    videoId,
    run: () =>
      runWorkerJob<Uint8Array>({
        send: port => port.send(WorkerMessageType.EmbedMetadata, { job }, [job.audioData]),
        transform: data => new Uint8Array(data ?? new ArrayBuffer(0))
      })
  });
}

type RunTranscodeAudioParams = Prettify<{
  videoId: string;
  job: TranscodeAudioJob;
}>;
export function runTranscodeAudio({ videoId, job }: RunTranscodeAudioParams) {
  return enqueueMuxJob({
    videoId,
    run: () =>
      runWorkerJob<Uint8Array>({
        send: port => port.send(WorkerMessageType.TranscodeAudio, { job }, [job.audioData]),
        transform(data) {
          const isDataMissing = !data;
          if (isDataMissing) {
            throw new Error("Worker returned no data for transcodeAudio");
          }

          return new Uint8Array(data);
        }
      })
  });
}

type RunTranscodeFileParams = Prettify<{
  videoId: string;
  job: TranscodeFileJob;
}>;
export function runTranscodeFile({ videoId, job }: RunTranscodeFileParams) {
  return enqueueMuxJob({
    videoId,
    run: () =>
      runWorkerJob<Uint8Array | null>({
        send: port => port.send(WorkerMessageType.TranscodeFile, { job }, [job.data]),
        transform: data => data ? new Uint8Array(data) : null
      })
  });
}
