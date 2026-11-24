// A minimal client for the Firefox DevTools Remote Debugging Protocol (RDP) over its `<byteLength>:<json>` framed socket
import { LOOPBACK_HOST, OsPlatform } from "#scripts/dev/enums.ts";
import { spawnSync } from "node:child_process";
import { connect } from "node:net";
import { platform } from "node:os";

const RDP_CONNECT_TIMEOUT_MS = 12_000;
const RDP_REPLY_TIMEOUT_MS = 9000;
const PROCESS_QUERY_TIMEOUT_MS = 10_000;
const DECIMAL_RADIX = 10;

export const RdpActor = {
  Root: "root"
} as const;

export const RdpRequestType = {
  GetProcess: "getProcess",
  GetTarget: "getTarget",
  ListAddons: "listAddons",
  GetWatcher: "getWatcher",
  WatchTargets: "watchTargets",
  EvaluateJsAsync: "evaluateJSAsync"
} as const;

export const RdpPacketType = {
  EvaluationResult: "evaluationResult",
  TargetAvailableForm: "target-available-form"
} as const;

export const RdpTargetType = {
  Frame: "frame"
} as const;

const START_DEBUGGER_SERVER_FLAG = "-start-debugger-server";
const RDP_LENGTH_SEPARATOR = ":";

export interface RdpPacket {
  from?: string;
  type?: string;
  target?: {
    url?: string;
    consoleActor?: string;
  };
  processDescriptor?: { actor?: string };
  process?: { consoleActor?: string };
  frame?: { consoleActor?: string };
  addons?: {
    id: string;
    actor: string;
    manifestURL: string;
  }[];
  actor?: string;
  result?: unknown;
  exceptionMessage?: string;
}

interface RdpWaiter {
  predicate: (packet: RdpPacket) => boolean;
  fulfill: (packet: RdpPacket) => void;
  reject: (error: Error) => void;
}

export type RdpClient = ReturnType<typeof createRdpClient>;

// web-ext picks the -start-debugger-server port per launch; read it off the dev Firefox's command
// line (the process running this dev server's profile). Stable for the session, so cached.
let cachedRdpPort: number | undefined;

function readFirefoxCommandLines(profileDir: string) {
  if (platform() === OsPlatform.Windows) {
    const profileLiteral = profileDir.replace(/'/g, "''");
    const script = `Get-CimInstance Win32_Process -Filter "name='firefox.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${profileLiteral}') } | Select-Object -ExpandProperty CommandLine`;
    const result = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", "-"], {
      input: script,
      encoding: "utf-8",
      timeout: PROCESS_QUERY_TIMEOUT_MS
    });
    return (result.stdout ?? "").split(/\r?\n/);
  }

  const result = spawnSync("ps", ["-eo", "args"], {
    encoding: "utf-8",
    timeout: PROCESS_QUERY_TIMEOUT_MS
  });
  return (result.stdout ?? "").split("\n").filter(line => line.includes(profileDir));
}

function parseRdpPort(commandLine: string) {
  const [, portText = ""] = commandLine.split(`${START_DEBUGGER_SERVER_FLAG} `);
  return parseInt(portText, DECIMAL_RADIX);
}

export function findFirefoxRdpPort(profileDir: string) {
  cachedRdpPort ??= readFirefoxCommandLines(profileDir).map(parseRdpPort).find(port => !Number.isNaN(port));
  return cachedRdpPort;
}

// Splits complete `<byteLength>:<json>` frames off the front of the buffer, keeping a partial tail
function splitRdpFrames(buffer: Buffer) {
  const frames: string[] = [];
  let rest = buffer;
  while (rest.includes(RDP_LENGTH_SEPARATOR)) {
    const separatorIndex = rest.indexOf(RDP_LENGTH_SEPARATOR);
    const frameEnd = separatorIndex + 1 + Number(rest.subarray(0, separatorIndex).toString("ascii"));
    if (Number.isNaN(frameEnd)) {
      rest = rest.subarray(separatorIndex + 1);
      continue;
    }

    if (rest.length < frameEnd) {
      break;
    }

    frames.push(rest.subarray(separatorIndex + 1, frameEnd).toString("utf8"));
    rest = rest.subarray(frameEnd);
  }
  return {
    frames,
    rest
  };
}

// A minimal RDP client over the `<byteLength>:<json>` framed socket
function createRdpClient(port: number) {
  const socket = connect(port, LOOPBACK_HOST);
  let buffer: Buffer = Buffer.alloc(0);
  const waiters: RdpWaiter[] = [];
  let closeError: Error | undefined;

  function rejectWaiters(error: Error) {
    if (closeError) {
      return;
    }

    closeError = error;
    for (const waiter of waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  function deliverPacket(frame: string) {
    try {
      const packet: RdpPacket = JSON.parse(frame);
      const iWaiter = waiters.findIndex(waiter => waiter.predicate(packet));
      if (iWaiter >= 0) {
        waiters.splice(iWaiter, 1)[0].fulfill(packet);
      }
    } catch { /* not a JSON frame */ }
  }

  socket.on("data", chunk => {
    const { frames, rest } = splitRdpFrames(Buffer.concat([buffer, Buffer.from(chunk)]));
    buffer = rest;
    for (const frame of frames) {
      deliverPacket(frame);
    }
  });
  socket.on("error", error => rejectWaiters(error));
  socket.on("close", () => rejectWaiters(new Error("RDP socket closed")));

  function send(message: Record<string, unknown>) {
    if (closeError) {
      return;
    }

    const bytes = Buffer.from(JSON.stringify(message), "utf8");
    socket.write(`${bytes.length}:`);
    socket.write(bytes);
  }

  function waitFor({ predicate, timeoutMs = RDP_REPLY_TIMEOUT_MS }: { predicate: (packet: RdpPacket) => boolean; timeoutMs?: number }) {
    return new Promise<RdpPacket>((resolve, reject) => {
      if (closeError) {
        reject(closeError);
        return;
      }

      const waiter: RdpWaiter = {
        predicate,
        fulfill(packet) {
          clearTimeout(timer);
          resolve(packet);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        }
      };
      // Drop a timed-out waiter, or it would steal a later matching packet from the next waitFor
      const timer = setTimeout(() => {
        const iWaiter = waiters.indexOf(waiter);
        if (iWaiter >= 0) {
          waiters.splice(iWaiter, 1);
        }

        reject(new Error("RDP reply timed out"));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }

  // RDP has no request ids - a reply is recognized by actor and shape - so the waiter is registered
  // before the request goes out (Firefox can answer within the same event-loop turn)
  function request({ to, type, extra = {}, predicate = () => true }: {
    to: string;
    type: string;
    extra?: Record<string, unknown>;
    predicate?: (packet: RdpPacket) => boolean;
  }) {
    const response = waitFor({ predicate: packet => packet.from === to && predicate(packet) });
    send({
      to,
      type,
      ...extra
    });
    return response;
  }

  return {
    send,
    waitFor,
    request,
    close: () => socket.destroy()
  };
}

// A client connected to the dev Firefox's debugger server, once the root actor has greeted it
export async function connectRdp(profileDir: string) {
  const port = findFirefoxRdpPort(profileDir);
  if (!port) {
    throw new Error("could not find the dev Firefox's RDP port");
  }

  const client = createRdpClient(port);
  await client.waitFor({
    predicate: packet => packet.from === RdpActor.Root,
    timeoutMs: RDP_CONNECT_TIMEOUT_MS
  });
  return client;
}
