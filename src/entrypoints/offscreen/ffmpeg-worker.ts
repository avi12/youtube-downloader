import { WorkerMessageType, type WorkerRequest } from "./ffmpeg-worker-protocol";
import createFFmpegCore from "@ffmpeg/core";

let core: Awaited<ReturnType<typeof createFFmpegCore>> | null = null;

function reply(id: number, result?: number | Uint8Array, transfer?: Transferable[]) {
  self.postMessage({
    id,
    type: "DONE",
    result
  }, { transfer: transfer ?? [] });
}

self.addEventListener("message", async ({ data }: MessageEvent<WorkerRequest>) => {
  if (data.type === WorkerMessageType.Unlink) {
    try {
      core!.FS.unlink(data.path);
    } catch {
      // file may not exist
    }
    return;
  }

  const { id, type } = data;
  try {
    switch (type) {
      case WorkerMessageType.Load: {
        core = await createFFmpegCore({ wasmBinary: data.wasmBinary });
        core.setProgress(({ progress }) => {
          self.postMessage({
            type: "PROGRESS",
            progress
          });
        });
        core.setLogger(({ type: logType, message }) => {
          self.postMessage({
            type: "LOG",
            logType,
            message
          });
        });
        reply(id);
        break;
      }
      case WorkerMessageType.Exec: {
        const exitCode = core!.exec(...data.args);
        reply(id, exitCode);
        break;
      }
      case WorkerMessageType.WriteFile: {
        core!.FS.writeFile(data.path, data.data);
        reply(id);
        break;
      }
      case WorkerMessageType.ReadFile: {
        const result = core!.FS.readFile(data.path, { encoding: "binary" });
        if (typeof result === "string") {
          throw new Error("Unexpected string from FS.readFile");
        }

        const copy = result.slice();
        reply(id, copy, [copy.buffer]);
        break;
      }
    }
  } catch (error) {
    self.postMessage({
      id,
      type: "ERROR",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
