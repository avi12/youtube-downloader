import { WorkerMessageType } from "./mux-worker-types";
import { getPendingJobReject, setWorkerPort } from "./worker-jobs";
import { createHostWorkerPort } from "./worker-port-host";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";

export { cancelMuxJobs } from "./mux-queue";
export {
  runEmbedMetadata,
  runMuxVideoAudio,
  runTranscodeAudio,
  runTranscodeFile
} from "./worker-jobs";

export async function initMuxWorker(wasmBinary: ArrayBuffer) {
  const hostPort = createHostWorkerPort();
  setWorkerPort(hostPort);

  await new Promise<void>((resolve, reject) => {
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
      const rejectJob = getPendingJobReject();
      const hasRejectJob = rejectJob !== null;
      if (hasRejectJob) {
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
  });

  await sendMessage(MessageType.PipelineFFmpegReady);
}
