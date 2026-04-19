import http from "node:http";
import WebSocket from "ws";

export interface CdpTarget {
  id: string;
  type: string;
  url?: string;
  webSocketDebuggerUrl?: string;
}

export interface CdpExceptionDetails {
  exception?: { description?: string };
  text?: string;
}

export interface CdpMessage {
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
  socket.on("message", rawData => {
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

export async function findExtensionTargets(port: number, extId: string) {
  const targets = await fetchTargets(port);
  return {
    serviceWorker: targets.find(target => target.type === "service_worker" && (target.url ?? "").includes(extId)),
    offscreen: targets.find(target => (target.url ?? "").includes("offscreen.html")),
    tab: targets.find(target => target.type === "page" && (target.url ?? "").includes("youtube.com/watch"))
  };
}

export function fetchTargets(port: number): Promise<CdpTarget[]> {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json`, response => {
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
