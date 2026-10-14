import { EventEmitter } from "node:events";
import http from "node:http";
import WebSocket from "ws";

export interface CdpTarget {
  id: string;
  type: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

interface CdpExceptionDetails {
  exception?: { description?: string };
  text?: string;
}

interface CdpMessage {
  method?: string;
  id?: number;
  result?: unknown;
  params?: {
    args?: Record<string, unknown>[];
    type?: string;
    exceptionDetails?: CdpExceptionDetails;
    entry?: {
      level?: string;
      text?: string;
    };
  };
}

// noinspection JSUnusedGlobalSymbols
// fallow-ignore-next-line unused-export
export function attachCdpMonitor(wsUrl: string, label: string, enableLog = false) {
  const socket = new WebSocket(wsUrl);
  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.enable"
      })
    );

    if (enableLog) {
      socket.send(
        JSON.stringify({
          id: 2,
          method: "Log.enable"
        })
      );
    }
  });
  socket.on("message", (rawData: WebSocket.RawData) => {
    const message: CdpMessage = JSON.parse(String(rawData));
    if (message.method === "Runtime.consoleAPICalled") {
      const text = (message.params?.args ?? []).map(arg => arg.value ?? arg.description ?? JSON.stringify(arg)).join(" ");
      console.log(`[${label}][${message.params?.type}] ${text}`);
    }

    if (message.method === "Runtime.exceptionThrown") {
      const detail = message.params?.exceptionDetails;
      console.log(`[${label}][EX] ${detail?.exception?.description ?? detail?.text ?? "?"}`);
    }

    if (enableLog && message.method === "Log.entryAdded") {
      console.log(`[${label}][log:${message.params?.entry?.level}] ${message.params?.entry?.text}`);
    }
  });
  return socket;
}

// noinspection JSUnusedGlobalSymbols
// fallow-ignore-next-line unused-export
export async function findExtensionTargets(port: number, extId: string) {
  const targets = await fetchTargets(port);
  return {
    serviceWorker: targets.find(target => target.type === "service_worker" && (target.url ?? "").includes(extId)),
    offscreen: targets.find(target => (target.url ?? "").includes("offscreen.html")),
    tab: targets.find(target => target.type === "page" && (target.url ?? "").includes("youtube.com/watch"))
  };
}

const CDP_CALL_TIMEOUT_MS = 10_000;

type CdpEnvelope = {
  id?: number;
  method?: string;
};

type PendingCdpCall = {
  settle: (rawMessage: string) => void;
  fail: (error: Error) => void;
};

// One DevTools session over a target's websocket: id-correlated commands plus event listeners.
// Replies reach callers as raw JSON so each parses it into its own declared shape.
export async function openCdpSession(websocketUrl: string) {
  const socket = new WebSocket(websocketUrl);
  const pendingCalls = new Map<number, PendingCdpCall>();
  const events = new EventEmitter();
  let nextId = 1;

  function failPendingCalls(error: Error) {
    for (const pendingCall of pendingCalls.values()) {
      pendingCall.fail(error);
    }
    pendingCalls.clear();
  }

  // A reply carries the id of its command; anything else is an event
  function routeMessage(rawMessage: string) {
    const { id, method }: CdpEnvelope = JSON.parse(rawMessage);
    if (id === undefined) {
      events.emit(String(method), rawMessage);
      return;
    }

    pendingCalls.get(id)?.settle(rawMessage);
    pendingCalls.delete(id);
  }

  socket.on("message", (rawData: WebSocket.RawData) => routeMessage(String(rawData)));
  socket.on("close", () => failPendingCalls(new Error("CDP session closed")));
  socket.on("error", error => failPendingCalls(error));

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });

  function send<TResult>(method: string, params: Record<string, unknown> = {}) {
    const id = nextId++;
    return new Promise<TResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingCalls.delete(id);
        reject(new Error(`${method} timed out`));
      }, CDP_CALL_TIMEOUT_MS);
      pendingCalls.set(id, {
        settle(rawMessage) {
          clearTimeout(timeout);
          const reply: {
            result: TResult;
            error?: { message?: string };
          } = JSON.parse(rawMessage);
          if (reply.error) {
            reject(new Error(`${method}: ${reply.error.message}`));
            return;
          }

          resolve(reply.result);
        },
        fail(error) {
          clearTimeout(timeout);
          reject(error);
        }
      });
      socket.send(JSON.stringify({
        id,
        method,
        params
      }));
    });
  }

  function on(method: string, listener: (rawMessage: string) => void) {
    events.on(method, listener);
  }

  return {
    send,
    on,
    close: () => socket.close()
  };
}

export type CdpSession = Awaited<ReturnType<typeof openCdpSession>>;

// Runtime.evaluate on a target (page, service worker), awaiting a returned promise and
// handing back its JSON value. A thrown exception rejects with the page's own message.
export async function evaluateOnTarget<TValue>(websocketUrl: string, expression: string) {
  const session = await openCdpSession(websocketUrl);
  try {
    const { result, exceptionDetails } = await session.send<{
      result: { value?: TValue };
      exceptionDetails?: CdpExceptionDetails;
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }

    return result.value;
  } finally {
    session.close();
  }
}

export async function closeTarget(port: number, targetId: string) {
  const response = await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`);
  return response.ok;
}

export function fetchTargets(port: number): Promise<CdpTarget[]> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json`, response => {
      let data = "";
      response.on("data", chunk => data += chunk);
      response.on("end", () => {
        const parsed: CdpTarget[] = JSON.parse(data);
        resolve(parsed);
      });
      response.on("error", reject);
    }).on("error", reject);
  });
}
