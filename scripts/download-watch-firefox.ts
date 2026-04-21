/**
 * Clicks the extension's download button on a YouTube watch page via Firefox
 * RDP and polls until the button transitions to a terminal state.
 *
 * Usage:
 *   npx tsx scripts/download-watch-firefox.ts
 */
import { execSync } from "node:child_process";
import net from "node:net";
import { setTimeout as wait } from "node:timers/promises";

const FIREFOX_RDP_PORT_FALLBACK = 9230;
const CONNECT_SETTLE_MS = 500;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 36;

function findFirefoxRdpPort() {
  try {
    const out = execSync(
      `powershell -Command "$firefoxPids = (Get-Process firefox -EA 0).Id; Get-NetTCPConnection -State Listen | Where-Object { $firefoxPids -contains $_.OwningProcess } | Select-Object -ExpandProperty LocalPort"`,
      { encoding: "utf8", timeout: 5000 }
    );
    const ports = out.trim().split(/\s+/).map(Number).filter(port => port > 1024 && port !== 9230);
    return ports[0] ?? FIREFOX_RDP_PORT_FALLBACK;
  } catch {
    return FIREFOX_RDP_PORT_FALLBACK;
  }
}

type Packet = Record<string, unknown> & { from?: string };

class RDP {
  private buffers: Buffer[] = [];
  private totalLength = 0;
  private listeners: Array<(p: Packet) => boolean> = [];
  private socket: net.Socket | null = null;

  async connect(port: number) {
    const socket = net.connect(port, "127.0.0.1");
    this.socket = socket;
    socket.on("data", buffer => {
      this.buffers.push(buffer);
      this.totalLength += buffer.length;
      this.parse();
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", () => resolve());
    });
    await wait(CONNECT_SETTLE_MS);
  }

  private parse() {
    while (true) {
      const buffer = Buffer.concat(this.buffers);
      const iColon = buffer.indexOf(":");
      if (iColon < 1) {
        return;
      }

      const length = parseInt(buffer.subarray(0, iColon).toString(), 10);
      if (isNaN(length) || this.totalLength < iColon + 1 + length) {
        return;
      }

      const raw = buffer.subarray(iColon + 1, iColon + 1 + length).toString("utf8");
      const remaining = buffer.subarray(iColon + 1 + length);
      this.buffers = remaining.length ? [remaining] : [];
      this.totalLength = remaining.length;

      let packet: Packet;
      try {
        packet = JSON.parse(raw);
      } catch {
        continue;
      }
      for (let i = 0; i < this.listeners.length; i++) {
        if (this.listeners[i](packet)) {
          this.listeners.splice(i, 1);
          break;
        }
      }
    }
  }

  waitFor(predicate: (p: Packet) => boolean): Promise<Packet> {
    return new Promise(resolve => {
      this.listeners.push(packet => {
        if (!predicate(packet)) {
          return false;
        }

        resolve(packet);
        return true;
      });
    });
  }

  send(to: string, type: string, extra: Record<string, unknown> = {}) {
    const message = JSON.stringify({ to, type, ...extra });
    this.socket!.write(Buffer.byteLength(message) + ":" + message);
  }

  async request(to: string, type: string, extra: Record<string, unknown> = {}) {
    const promise = this.waitFor(packet => packet.from === to);
    this.send(to, type, extra);
    return promise;
  }

  destroy() {
    this.socket?.destroy();
  }
}

async function evalJs(rdp: RDP, consoleActor: string, expression: string): Promise<unknown> {
  const initial = await rdp.request(consoleActor, "evaluateJSAsync", { text: expression });
  const resultId = initial.resultID as string;
  const final = await rdp.waitFor(p => p.from === consoleActor && p.resultID === resultId);
  if (final.exception) {
    throw new Error(`JS exception: ${final.exceptionMessage ?? JSON.stringify(final.exception)}`);
  }

  const result = final.result as Packet | string | number | boolean | null | undefined;
  if (result && typeof result === "object" && "type" in result) {
    if (result.type === "undefined") {
      return undefined;
    }
    if (result.type === "null") {
      return null;
    }
  }
  return result;
}

const port = findFirefoxRdpPort();
console.log(`Connecting to Firefox RDP on port ${port}...`);
const rdp = new RDP();
await rdp.connect(port);

const tabsResponse = await rdp.request("root", "listTabs");
const tabs = (tabsResponse.tabs as Array<{ actor: string; url?: string }>) ?? [];
const watchTab = tabs.find(t => t.url?.includes("/watch"));
if (!watchTab) {
  console.error("No watch tab open in Firefox.");
  rdp.destroy();
  process.exit(1);
}
console.log("Found watch tab:", watchTab.url);

const targetResponse = await rdp.request(watchTab.actor, "getTarget");
const frame = targetResponse.frame as { consoleActor?: string } | undefined;
const consoleActor = frame?.consoleActor;
if (!consoleActor) {
  console.error("No consoleActor in getTarget response");
  rdp.destroy();
  process.exit(1);
}

const clickResult = await evalJs(rdp, consoleActor, `
  JSON.stringify((() => {
    const elGroup = document.querySelector('[data-ytdl-download-group]');
    const elBtn = elGroup?.querySelector('yt-button-view-model:first-child button');
    const label = elBtn?.getAttribute('aria-label') ?? '';
    elBtn?.click();
    return { clicked: !!elBtn, initialLabel: label.slice(0, 80) };
  })())
`);
console.log("Click:", clickResult);
const click = JSON.parse(clickResult as string);
if (!click.clicked) {
  console.error("No watch-page download button found; make sure the page is a watch URL with the extension loaded.");
  rdp.destroy();
  process.exit(1);
}

for (let i = 0; i < MAX_POLLS; i++) {
  await wait(POLL_INTERVAL_MS);
  const stateJson = await evalJs(rdp, consoleActor, `
    JSON.stringify((() => {
      const elGroup = document.querySelector('[data-ytdl-download-group]');
      const elBtn = elGroup?.querySelector('yt-button-view-model:first-child button');
      const label = elBtn?.getAttribute('aria-label') ?? '';
      const elProgress = elGroup?.querySelector('tp-yt-paper-progress');
      return { label: label.slice(0, 80), progress: elProgress?.getAttribute('value') };
    })())
  `);
  const state = JSON.parse(stateJson as string);
  const elapsed = (i + 1) * (POLL_INTERVAL_MS / 1000);
  console.log(`T+${elapsed}s: label="${state.label}" progress=${state.progress ?? "n/a"}`);
  const label = (state.label ?? "").toLowerCase();
  if (label.includes("downloaded") || label.includes("download again") || label.includes("open")) {
    console.log("SUCCESS: Download completed on Firefox.");
    rdp.destroy();
    process.exit(0);
  }
  if (label.includes("deleted") || label.includes("failed") || label.includes("error") || label.includes("retry")) {
    console.log("FAILURE: Download failed.");
    rdp.destroy();
    process.exit(2);
  }
}

console.log("Timed out waiting for download.");
rdp.destroy();
process.exit(1);
