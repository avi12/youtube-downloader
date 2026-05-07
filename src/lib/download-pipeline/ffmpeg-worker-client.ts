import {
  WorkerMessageType,
  type WorkerRequestProtocol,
  type WorkerResponse
} from "@/entrypoints/offscreen/ffmpeg-worker-protocol";

type ProgressEvent = { progress: number };
type LogEntry = {
  type: string;
  message: string;
};

export class FFmpegWorkerClient {
  private nextId = 0;
  private pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private progressCallback: ((progress: ProgressEvent) => void) | null = null;
  private logCallback: ((entry: LogEntry) => void) | null = null;

  readonly FS = {
    writeFile: async (path: string, data: Uint8Array) => {
      const copy = data.slice();
      await this.sendRaw(WorkerMessageType.WriteFile, {
        path,
        data: copy
      }, [copy.buffer]);
    },
    readFile: async (path: string) => {
      const result = await this.sendRaw(WorkerMessageType.ReadFile, { path });
      if (!(result instanceof Uint8Array)) {
        throw new Error("READ_FILE response is not a Uint8Array");
      }

      return result;
    },
    unlink: (path: string) => {
      this.worker.postMessage({
        type: WorkerMessageType.Unlink,
        path
      });
    }
  };

  constructor(private worker: Worker) {
    worker.addEventListener("message", ({ data: msg }: MessageEvent<WorkerResponse>) => {
      if (msg.type === "PROGRESS") {
        this.progressCallback?.({ progress: msg.progress });
        return;
      }

      if (msg.type === "LOG") {
        this.logCallback?.({
          type: msg.logType,
          message: msg.message
        });
        return;
      }

      const pending = this.pending.get(msg.id);
      if (!pending) {
        return;
      }

      this.pending.delete(msg.id);

      if (msg.type === "ERROR") {
        pending.reject(new Error(msg.message));
      } else {
        pending.resolve(msg.result);
      }
    });
  }

  onProgress(callback: (progress: ProgressEvent) => void) {
    this.progressCallback = callback;
  }

  onLog(callback: (entry: LogEntry) => void) {
    this.logCallback = callback;
  }

  async load(wasmBinary: ArrayBuffer) {
    await this.sendRaw(WorkerMessageType.Load, { wasmBinary }, [wasmBinary]);
  }

  async exec(...args: string[]) {
    const result = await this.sendRaw(WorkerMessageType.Exec, { args });
    if (typeof result !== "number") {
      throw new Error("EXEC response is not a number");
    }

    return result;
  }

  private sendRaw<T extends keyof WorkerRequestProtocol>(
    type: T,
    data: WorkerRequestProtocol[T],
    transfer?: Transferable[]
  ) {
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, {
        resolve,
        reject
      });
      const msg = {
        id,
        type,
        ...data
      };
      if (transfer?.length) {
        this.worker.postMessage(msg, transfer);
      } else {
        this.worker.postMessage(msg);
      }
    });
  }
}
