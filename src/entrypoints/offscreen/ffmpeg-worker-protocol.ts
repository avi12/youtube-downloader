export const WorkerMessageType = {
  Load: "LOAD",
  Exec: "EXEC",
  WriteFile: "WRITE_FILE",
  ReadFile: "READ_FILE",
  Unlink: "UNLINK"
} as const;

export type WorkerMessageType = (typeof WorkerMessageType)[keyof typeof WorkerMessageType];

type WorkerRpcType = Exclude<WorkerMessageType, typeof WorkerMessageType.Unlink>;

export interface WorkerRequestProtocol {
  [WorkerMessageType.Load]: { wasmBinary: ArrayBuffer };
  [WorkerMessageType.Exec]: { args: string[] };
  [WorkerMessageType.WriteFile]: {
    path: string;
    data: Uint8Array;
  };
  [WorkerMessageType.ReadFile]: { path: string };
}

type WorkerRpcRequest = {
  [T in WorkerRpcType]: {
    id: number;
    type: T;
  } & WorkerRequestProtocol[T];
}[WorkerRpcType];

type WorkerUnlinkMessage = {
  type: typeof WorkerMessageType.Unlink;
  path: string;
};

export type WorkerRequest = WorkerRpcRequest | WorkerUnlinkMessage;

export type WorkerDoneResponse = {
  id: number;
  type: "DONE";
  result: unknown;
};

export type WorkerErrorResponse = {
  id: number;
  type: "ERROR";
  message: string;
};

export type WorkerProgressResponse = {
  type: "PROGRESS";
  progress: number;
};

export type WorkerLogResponse = {
  type: "LOG";
  logType: string;
  message: string;
};

export type WorkerResponse = WorkerDoneResponse | WorkerErrorResponse | WorkerProgressResponse | WorkerLogResponse;
