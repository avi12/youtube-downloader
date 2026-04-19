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
const durationMs = (parseInt(process.argv[2] ?? "30") || 30) * 1000;

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
  bufs: Buffer[];
  totalLen: number;
  pending: Map<string, (pkt: Record<string, unknown>) => void>;
  onEvent: ((pkt: Record<string, unknown>) => void) | null;
  sock: ReturnType<typeof net.connect> | null;

  constructor(port: number) {
    this.port = port;
    this.bufs = [];
    this.totalLen = 0;
    this.pending = new Map();
    this.onEvent = null;
    this.sock = null;
  }

  connect() {
    return new Promise<void>((resolve, reject) => {
      this.sock = net.connect(this.port, "127.0.0.1");
      this.sock.on("data", (buf: Buffer) => {
        this.bufs.push(buf);
        this.totalLen += buf.length;
        this._parse();
      });
      this.sock.on("error", reject);
      this.sock.on("connect", async () => {
        await setTimeout(CONNECT_SETTLE_MS);
        resolve();
      });
    });
  }

  _parse() {
    while (true) {
      const buf = Buffer.concat(this.bufs);
      const colonIdx = buf.indexOf(":");
      if (colonIdx < 1) {
        break;
      }

      const len = parseInt(buf.slice(0, colonIdx).toString());
      if (isNaN(len) || this.totalLen < colonIdx + 1 + len) {
        break;
      }

      this.bufs = [buf.slice(colonIdx + 1 + len)];
      this.totalLen -= colonIdx + 1 + len;
      try {
        const pkt = JSON.parse(buf.slice(colonIdx + 1, colonIdx + 1 + len).toString("utf8"));
        const handler = this.pending.get(pkt.from);
        if (handler) {
          this.pending.delete(pkt.from);
          handler(pkt);
        } else {
          this.onEvent?.(pkt);
        }
      } catch { /* malformed packet */ }
    }
  }

  send(to: string, type: string, extra: Record<string, unknown> = {}) {
    const msg = JSON.stringify({
      to,
      type,
      ...extra
    });
    this.sock!.write(msg.length + ":" + msg);
  }

  request(to: string, type: string, extra: Record<string, unknown> = {}) {
    return new Promise<Record<string, unknown>>(resolve => {
      this.pending.set(to, resolve);
      this.send(to, type, extra);
    });
  }

  destroy() {
    this.sock?.destroy();
  }
}

// ── Subscribe a watcher actor to console-message resources ──────────────────

function subscribeWatcher(rdp: RDP, watcherActor: string) {
  rdp.send(watcherActor, "watchTargets", { targetType: "frame" });
  rdp.send(watcherActor, "watchResources", { resourceTypes: ["console-message"] });
}

// ── Message formatter ────────────────────────────────────────────────────────

function formatArgs(args: Record<string, unknown>[] = []) {
  return args.map(arg => {
    if (typeof arg === "string") {
      return arg;
    }

    if (arg?.type === "object") {
      const className = arg.class;
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
  const msg = error instanceof Error ? error.message : String(error);
  console.error(`Cannot connect to Firefox RDP on port ${port}: ${msg}`);
  console.error("Is the dev server running with --firefox?");
  process.exit(1);
}

// Set event handler BEFORE subscribing so we don't miss early events
let msgCount = 0;
rdp.onEvent = (pkt: Record<string, unknown>) => {
  if (pkt.type !== "resources-available-array") {
    return;
  }

  const arr = pkt.array;
  if (!Array.isArray(arr)) {
    return;
  }

  for (const item of arr) {
    if (!Array.isArray(item) || item.length < 2) {
      continue;
    }

    const resourceType = item[0];
    const rawMessages = item[1];
    if (typeof resourceType !== "string" || resourceType !== "console-message") {
      continue;
    }

    if (!Array.isArray(rawMessages)) {
      continue;
    }

    for (const rawMsg of rawMessages) {
      if (!isRecordObject(rawMsg)) {
        continue;
      }

      const levelVal = rawMsg.level;
      const level = typeof levelVal === "string" ? levelVal : "log";
      const rawArgs = Array.isArray(rawMsg.arguments) ? rawMsg.arguments.filter(isRecordObject) : [];
      const args = formatArgs(rawArgs);
      if (!args.trim()) {
        continue;
      }

      const timestampVal = rawMsg.timeStamp;
      const timestamp = typeof timestampVal === "number" ? timestampVal : Date.now();
      const time = new Date(timestamp).toISOString().slice(11, 23);
      console.log(`[${time}][${level.toUpperCase()}] ${args}`);
      msgCount++;
    }
  }
};

// Find the extension
const addonsResp = await rdp.request("root", "listAddons", { iconDataURL: false });
const addons = addonsResp.addons;
const ytdl = Array.isArray(addons) ? addons.find(isYtdlAddon) : undefined;
if (!ytdl) {
  console.error("YouTube Downloader extension not found in Firefox.");
  process.exit(1);
}

console.log(`Found: ${ytdl.name} (${ytdl.backgroundScriptStatus ?? "unknown status"})`);

// Find YouTube tabs
const tabsResp = await rdp.request("root", "listTabs");
const rawTabs = tabsResp.tabs;
const youtubeTabs = (Array.isArray(rawTabs) ? rawTabs : []).filter(isFirefoxTab).filter(tab => tab.url?.includes("youtube.com"));
console.log(`YouTube tabs: ${youtubeTabs.length}`);

// Subscribe to extension background
const extWatcherResp = await rdp.request(ytdl.actor, "getWatcher", { isServerTargetSwitchingEnabled: false });
const extWatcherActor = extWatcherResp.actor;
if (typeof extWatcherActor === "string") {
  subscribeWatcher(rdp, extWatcherActor);
  console.log("  Subscribed: extension background");
}

// Subscribe to each YouTube tab
for (const tab of youtubeTabs) {
  const tabWatcherResp = await rdp.request(tab.actor, "getWatcher", { isServerTargetSwitchingEnabled: false });
  const tabWatcherActor = tabWatcherResp.actor;
  if (typeof tabWatcherActor === "string") {
    subscribeWatcher(rdp, tabWatcherActor);
    console.log(`  Subscribed: tab: ${tab.url?.slice(0, 60)}`);
  }
}

await setTimeout(SUBSCRIBE_SETTLE_MS);

console.log(`\nMonitoring for ${durationMs / 1000}s...\n`);

await setTimeout(durationMs);

console.log(`\nDone. ${msgCount} message(s) captured.`);
rdp.destroy();
