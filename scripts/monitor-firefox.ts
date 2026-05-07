import { execSync } from "node:child_process";
/**
 * Monitor console messages from the YouTube Downloader extension in Firefox
 * using the Firefox Remote Debugging Protocol (RDP).
 *
 * Watches both the extension background page AND YouTube tab frames, since
 * content script logs appear in the tab context, not the extension context.
 *
 * Usage:
 *   node scripts/monitor-firefox.mjs [durationSeconds]
 *
 * Requires dev-server started with --firefox.
 * Firefox RDP is a length-prefixed TCP protocol: <byteLength>:<json>
 */
import net from "node:net";
import { setTimeout } from "node:timers/promises";

const YTDL_ID = "youtube-downloader@avi12.com";
const FIREFOX_RDP_PORT_FALLBACK = 64173;
const CONNECT_SETTLE_MS = 600;
const SUBSCRIBE_SETTLE_MS = 500;
const durationMs = (parseInt(process.argv[2] ?? "30", 10) || 30) * 1000;

// ── Port discovery ──────────────────────────────────────────────────────────

function findFirefoxRdpPort() {
  try {
    const out = execSync(
      `powershell -Command "` +
      `$pids = (Get-Process firefox -EA 0).Id; ` +
      `Get-NetTCPConnection -State Listen | ` +
      `Where-Object { $pids -contains $_.OwningProcess } | ` +
      `Select-Object -ExpandProperty LocalPort"`,
      {
        encoding: "utf8",
        timeout: 5000
      }
    );
    const ports = out.trim().split(/\s+/).map(Number).filter(port => port > 1024 && port !== 9230);
    return ports[0] ?? FIREFOX_RDP_PORT_FALLBACK;
  } catch {
    return FIREFOX_RDP_PORT_FALLBACK;
  }
}

// ── RDP client ──────────────────────────────────────────────────────────────

class RDP {
  port: number;
  buffers: Buffer[];
  totalLength: number;
  pending: Map<string, (packet: Record<string, unknown>) => void>;
  onEvent: ((packet: Record<string, unknown>) => void) | null;
  socket: ReturnType<typeof net.connect> | null;

  constructor(port: number) {
    this.port = port;
    this.buffers = [];
    this.totalLength = 0;
    this.pending = new Map();
    this.onEvent = null;
    this.socket = null;
  }

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
        await setTimeout(CONNECT_SETTLE_MS);
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
        const packet: {
          from: string;
          [key: string]: unknown;
        } = JSON.parse(buffer.subarray(iColon + 1, iColon + 1 + length).toString("utf8"));
        const handler = this.pending.get(packet.from);
        if (handler) {
          this.pending.delete(packet.from);
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

  destroy() {
    this.socket?.destroy();
  }
}

// ── Subscribe a watcher actor to console-message resources ──────────────────

function subscribeWatcher(rdp: RDP, watcherActor: string) {
  rdp.send(watcherActor, "watchTargets", { targetType: "frame" });
  rdp.send(watcherActor, "watchResources", { resourceTypes: ["console-message"] });
}

// ── Message formatter ────────────────────────────────────────────────────────

function formatArgs(args: unknown[] = []) {
  return args.map(arg => {
    if (typeof arg === "string") {
      return arg;
    }

    if (typeof arg !== "object" || arg === null || Array.isArray(arg)) {
      return JSON.stringify(arg);
    }

    const objArg = arg as Record<string, unknown>;
    if (objArg.type === "string" && typeof objArg.value === "string") {
      return objArg.value;
    }

    if (objArg.type === "object") {
      const className = objArg.class;
      return `[${typeof className === "string" ? className : "Object"}]`;
    }

    return JSON.stringify(arg);
  }).join(" ");
}

function isRecordObject(item: unknown): item is Record<string, unknown> {
  return typeof item === "object" && item !== null && !Array.isArray(item);
}

// ── Type guards ──────────────────────────────────────────────────────────────

interface FirefoxAddon {
  id: string;
  name: string;
  actor: string;
  backgroundScriptStatus?: string;
}

interface FirefoxTab {
  actor: string;
  url?: string;
}

function isFirefoxAddon(item: unknown): item is FirefoxAddon {
  return typeof item === "object" && item !== null &&
    "id" in item && typeof item.id === "string" &&
    "name" in item && typeof item.name === "string" &&
    "actor" in item && typeof item.actor === "string";
}

function isYtdlAddon(item: unknown): item is FirefoxAddon {
  return isFirefoxAddon(item) && item.id === YTDL_ID;
}

function isFirefoxTab(item: unknown): item is FirefoxTab {
  return typeof item === "object" && item !== null &&
    "actor" in item && typeof item.actor === "string";
}

// ── Main ────────────────────────────────────────────────────────────────────

const port = findFirefoxRdpPort();
console.log(`Connecting to Firefox RDP on port ${port}...`);

const rdp = new RDP(port);
try {
  await rdp.connect();
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`Cannot connect to Firefox RDP on port ${port}: ${errorMessage}`);
  console.error("Is the dev server running with --firefox?");
  process.exit(1);
}

// Set event handler BEFORE subscribing so we don't miss early events
let messageCount = 0;
rdp.onEvent = (packet: Record<string, unknown>) => {
  if (packet.type !== "resources-available-array") {
    return;
  }

  const resourcesArray = packet.array;
  if (!Array.isArray(resourcesArray)) {
    return;
  }

  for (const item of resourcesArray) {
    if (!Array.isArray(item) || item.length < 2) {
      continue;
    }

    const [resourceType, rawMessages] = item;
    if (typeof resourceType !== "string" || resourceType !== "console-message") {
      continue;
    }

    if (!Array.isArray(rawMessages)) {
      continue;
    }

    for (const rawMessage of rawMessages) {
      if (!isRecordObject(rawMessage)) {
        continue;
      }

      const levelValue = rawMessage.level;
      const level = typeof levelValue === "string" ? levelValue : "log";
      const rawArgs: unknown[] = Array.isArray(rawMessage.arguments) ? rawMessage.arguments : [];
      const formattedArgs = formatArgs(rawArgs);
      if (!formattedArgs.trim()) {
        continue;
      }

      const timestampValue = rawMessage.timeStamp;
      const timestamp = typeof timestampValue === "number" ? timestampValue : Date.now();
      const time = new Date(timestamp).toISOString().slice(11, 23);
      console.log(`[${time}][${level.toUpperCase()}] ${formattedArgs}`);
      messageCount++;
    }
  }
};

// Find the extension
const addonsResponse = await rdp.request("root", "listAddons", { iconDataURL: false });
const addons = addonsResponse.addons;
const ytdl = Array.isArray(addons) ? addons.find(isYtdlAddon) : undefined;
if (!ytdl) {
  console.error("YouTube Downloader extension not found in Firefox.");
  process.exit(1);
}

console.log(`Found: ${ytdl.name} (${ytdl.backgroundScriptStatus ?? "unknown status"})`);

// Find YouTube tabs
const tabsResponse = await rdp.request("root", "listTabs");
const rawTabs = tabsResponse.tabs;
const youtubeTabs = (Array.isArray(rawTabs) ? rawTabs : []).filter(isFirefoxTab).filter(tab => tab.url?.includes("youtube.com"));
console.log(`YouTube tabs: ${youtubeTabs.length}`);

// Subscribe to extension background
const extensionWatcherResponse = await rdp.request(ytdl.actor, "getWatcher", { isServerTargetSwitchingEnabled: false });
const extensionWatcherActor = extensionWatcherResponse.actor;
if (typeof extensionWatcherActor === "string") {
  subscribeWatcher(rdp, extensionWatcherActor);
  console.log("  Subscribed: extension background");
}

// Subscribe to each YouTube tab
for (const tab of youtubeTabs) {
  const tabWatcherResponse = await rdp.request(tab.actor, "getWatcher", { isServerTargetSwitchingEnabled: false });
  const tabWatcherActor = tabWatcherResponse.actor;
  if (typeof tabWatcherActor === "string") {
    subscribeWatcher(rdp, tabWatcherActor);
    console.log(`  Subscribed: tab: ${tab.url?.slice(0, 60)}`);
  }
}

await setTimeout(SUBSCRIBE_SETTLE_MS);

console.log(`\nMonitoring for ${durationMs / 1000}s...\n`);

await setTimeout(durationMs);

console.log(`\nDone. ${messageCount} message(s) captured.`);
rdp.destroy();
