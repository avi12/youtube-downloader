/**
 * Minimal Firefox RDP (Remote Debugging Protocol) client.
 *
 * Firefox exposes its devtools on a dynamically-assigned TCP port — distinct
 * from Marionette (2828) and the CDP/BiDi Remote Agent (9230). This module
 * discovers that port and speaks RDP's length-prefixed JSON framing:
 * `<byte-length>:<json>`.
 *
 * Used by:
 *  - scripts/debug-download-firefox.ts (extension + tab log streaming)
 *  - scripts/dev-server.ts (YouTube tab reload on Firefox)
 */
import { execSync } from "node:child_process";
import net from "node:net";
import { platform } from "node:os";
import { setTimeout as wait } from "node:timers/promises";

const FIREFOX_NON_RDP_PORTS = new Set([2828, 9230]);
const CONNECT_SETTLE_MS = 600;
const EVAL_TIMEOUT_MS = 30_000;

export function isRecord(item: unknown): item is Record<string, unknown> {
  return typeof item === "object" && item !== null && !Array.isArray(item);
}

export interface FirefoxTab {
  actor: string;
  url?: string;
}

export function isFirefoxTab(item: unknown): item is FirefoxTab {
  return isRecord(item) && typeof item.actor === "string";
}

export function findFirefoxRdpPort() {
  if (platform() !== "win32") {
    return null;
  }

  try {
    const out = execSync(
      `powershell -Command "`
      + `$pids = (Get-Process firefox -EA 0).Id; `
      + `Get-NetTCPConnection -State Listen | `
      + `Where-Object { $pids -contains $_.OwningProcess } | `
      + `Select-Object -ExpandProperty LocalPort"`,
      {
        encoding: "utf8",
        timeout: 5000
      }
    );
    const ports = out.trim().split(/\s+/).map(Number).filter(port => port > 1024 && !FIREFOX_NON_RDP_PORTS.has(port));
    return ports[0] ?? null;
  } catch {
    return null;
  }
}

export class RDP {
  private buffers: Buffer[] = [];
  private totalLength = 0;
  private pending = new Map<string, (packet: Record<string, unknown>) => void>();
  onEvent: ((packet: Record<string, unknown>) => void) | null = null;
  private socket: ReturnType<typeof net.connect> | null = null;

  constructor(private port: number) {}

  connect() {
    return new Promise<void>((resolve, reject) => {
      this.socket = net.connect(this.port, "127.0.0.1");
      this.socket.on("data", (buffer: Buffer) => {
        this.buffers.push(buffer);
        this.totalLength += buffer.length;
        this.parseIncoming();
      });
      this.socket.on("error", reject);
      this.socket.on("connect", async () => {
        await wait(CONNECT_SETTLE_MS);
        resolve();
      });
    });
  }

  private parseIncoming() {
    while (true) {
      const buffer = Buffer.concat(this.buffers);
      const iColon = buffer.indexOf(":");
      if (iColon < 1) {
        break;
      }

      const length = parseInt(buffer.subarray(0, iColon).toString(), 10);
      if (isNaN(length) || this.totalLength < iColon + 1 + length) {
        break;
      }

      this.buffers = [buffer.subarray(iColon + 1 + length)];
      this.totalLength -= iColon + 1 + length;
      try {
        const raw: unknown = JSON.parse(
          buffer.subarray(iColon + 1, iColon + 1 + length).toString("utf8")
        );
        if (!isRecord(raw)) {
          continue;
        }

        const packet = raw;
        const from = String(packet.from ?? "");
        const handler = this.pending.get(from);
        if (handler) {
          this.pending.delete(from);
          handler(packet);
        } else {
          this.onEvent?.(packet);
        }
      } catch { /* malformed packet */ }
    }
  }

  send(to: string, type: string, extra: Record<string, unknown> = {}) {
    const message = JSON.stringify({
      to,
      type,
      ...extra
    });
    this.socket!.write(message.length + ":" + message);
  }

  request(to: string, type: string, extra: Record<string, unknown> = {}) {
    return new Promise<Record<string, unknown>>(resolve => {
      this.pending.set(to, resolve);
      this.send(to, type, extra);
    });
  }

  async listTabs(): Promise<FirefoxTab[]> {
    const result = await this.request("root", "listTabs");
    if (!Array.isArray(result.tabs)) {
      return [];
    }

    return result.tabs.filter(isFirefoxTab);
  }

  async getConsoleActor(tabActor: string): Promise<string | null> {
    const result = await this.request(tabActor, "getTarget");
    if (!isRecord(result.frame) || typeof result.frame.consoleActor !== "string") {
      return null;
    }

    return result.frame.consoleActor;
  }

  // Firefox RDP protocol: evaluateJSAsync → ACK, then evaluationResult event
  // asynchronously. Firefox generates its own resultID and may dispatch the
  // result from a different conn id, so match only on `packet.type`.
  evalInTab(consoleActor: string, text: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("eval timeout"));
      }, EVAL_TIMEOUT_MS);

      const prevOnEvent = this.onEvent;
      this.onEvent = (packet: Record<string, unknown>) => {
        prevOnEvent?.(packet);

        if (packet.type !== "evaluationResult") {
          return;
        }

        clearTimeout(timeoutId);
        this.onEvent = prevOnEvent;

        if (packet.exceptionMessage) {
          resolve(`EX: ${packet.exceptionMessage}`);
          return;
        }

        const resultValue = packet.result;
        if (typeof resultValue === "string") {
          resolve(resultValue); return;
        }

        if (typeof resultValue === "number" || typeof resultValue === "boolean") {
          resolve(String(resultValue)); return;
        }

        if (isRecord(resultValue) && resultValue.type === "longString") {
          const actor = String(resultValue.actor ?? "");
          const length = Number(resultValue.length ?? 0);
          if (actor && length > 0) {
            this.request(actor, "substring", { start: 0, end: length })
              .then(sub => resolve(String(sub.substring ?? sub.initial ?? resultValue.initial ?? "")))
              .catch(() => resolve(String(resultValue.initial ?? "")));
          } else {
            resolve(String(resultValue.initial ?? ""));
          }
          return;
        }

        if (isRecord(resultValue) && resultValue.type === "null") {
          resolve("null"); return;
        }

        if (isRecord(resultValue) && resultValue.type === "undefined") {
          resolve("undefined"); return;
        }

        resolve(JSON.stringify(resultValue));
      };

      this.send(consoleActor, "evaluateJSAsync", {
        text,
        frameActor: null
      });
    });
  }

  destroy() {
    this.socket?.destroy();
  }
}
