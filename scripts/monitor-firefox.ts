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
import net from "net";
import { execSync } from "child_process";

const YTDL_ID = "youtube-downloader@avi12.com";
const FIREFOX_RDP_PORT_FALLBACK = 64173;
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
      { encoding: "utf8", timeout: 5000 }
    );
    const ports = out.trim().split(/\s+/).map(Number).filter(p => p > 1024 && p !== 9230);
    return ports[0] ?? FIREFOX_RDP_PORT_FALLBACK;
  } catch {
    return FIREFOX_RDP_PORT_FALLBACK;
  }
}

// ── RDP client ──────────────────────────────────────────────────────────────

class RDP {
  constructor(port) {
    this.port = port;
    this.bufs = [];
    this.totalLen = 0;
    this.pending = new Map();
    this.onEvent = null;
    this.sock = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(this.port, "127.0.0.1");
      this.sock.on("data", d => { this.bufs.push(d); this.totalLen += d.length; this._parse(); });
      this.sock.on("error", reject);
      this.sock.on("connect", () => setTimeout(resolve, 600));
    });
  }

  _parse() {
    while (true) {
      const b = Buffer.concat(this.bufs);
      const c = b.indexOf(":");
      if (c < 1) break;
      const len = parseInt(b.slice(0, c).toString());
      if (isNaN(len) || this.totalLen < c + 1 + len) break;
      this.bufs = [b.slice(c + 1 + len)];
      this.totalLen -= c + 1 + len;
      try {
        const pkt = JSON.parse(b.slice(c + 1, c + 1 + len).toString("utf8"));
        const h = this.pending.get(pkt.from);
        if (h) {
          this.pending.delete(pkt.from);
          h(pkt);
        } else {
          this.onEvent?.(pkt);
        }
      } catch { /* malformed packet */ }
    }
  }

  send(to, type, extra = {}) {
    const m = JSON.stringify({ to, type, ...extra });
    this.sock.write(m.length + ":" + m);
  }

  request(to, type, extra = {}) {
    return new Promise(resolve => {
      this.pending.set(to, resolve);
      this.send(to, type, extra);
    });
  }

  destroy() { this.sock?.destroy(); }
}

// ── Subscribe a watcher actor to console-message resources ──────────────────

function subscribeWatcher(rdp, watcherActor) {
  rdp.send(watcherActor, "watchTargets", { targetType: "frame" });
  rdp.send(watcherActor, "watchResources", { resourceTypes: ["console-message"] });
}

// ── Message formatter ────────────────────────────────────────────────────────

function formatArgs(args = []) {
  return args.map(a => {
    if (typeof a === "string") return a;
    if (a?.type === "object") return `[${a.class ?? "Object"}]`;
    return JSON.stringify(a);
  }).join(" ");
}

// ── Main ────────────────────────────────────────────────────────────────────

const port = findFirefoxRdpPort();
console.log(`Connecting to Firefox RDP on port ${port}...`);

const rdp = new RDP(port);
try {
  await rdp.connect();
} catch (e) {
  console.error(`Cannot connect to Firefox RDP on port ${port}: ${e.message}`);
  console.error("Is the dev server running with --firefox?");
  process.exit(1);
}

// Set event handler BEFORE subscribing so we don't miss early events
let msgCount = 0;
rdp.onEvent = pkt => {
  // Firefox uses "resources-available-array" with pkt.array = [[type, [msgs]], ...]
  if (pkt.type !== "resources-available-array") return;
  for (const [resourceType, messages] of pkt.array ?? []) {
    if (resourceType !== "console-message") continue;
    for (const msg of messages) {
      const level = msg.level ?? "log";
      const args = formatArgs(msg.arguments);
      if (!args.trim()) continue;
      const time = new Date(msg.timeStamp ?? Date.now()).toISOString().slice(11, 23);
      console.log(`[${time}][${level.toUpperCase()}] ${args}`);
      msgCount++;
    }
  }
};

// Find the extension
const addons = await rdp.request("root", "listAddons", { iconDataURL: false });
const ytdl = addons.addons?.find(a => a.id === YTDL_ID);
if (!ytdl) {
  console.error("YouTube Downloader extension not found in Firefox.");
  process.exit(1);
}
console.log(`Found: ${ytdl.name} (${ytdl.backgroundScriptStatus ?? "unknown status"})`);

// Find YouTube tabs
const tabs = await rdp.request("root", "listTabs");
const youtubeTabs = (tabs.tabs ?? []).filter(t => t.url?.includes("youtube.com"));
console.log(`YouTube tabs: ${youtubeTabs.length}`);

// Subscribe to extension background
const extWatcherResp = await rdp.request(ytdl.actor, "getWatcher", { isServerTargetSwitchingEnabled: false });
if (extWatcherResp.actor) {
  subscribeWatcher(rdp, extWatcherResp.actor);
  console.log("  Subscribed: extension background");
}

// Subscribe to each YouTube tab
for (const tab of youtubeTabs) {
  const tabWatcherResp = await rdp.request(tab.actor, "getWatcher", { isServerTargetSwitchingEnabled: false });
  if (tabWatcherResp.actor) {
    subscribeWatcher(rdp, tabWatcherResp.actor);
    console.log(`  Subscribed: tab: ${tab.url?.slice(0, 60)}`);
  }
}

// Small delay to let target-available events flush before printing "Monitoring"
await new Promise(r => setTimeout(r, 500));

console.log(`\nMonitoring for ${durationMs / 1000}s...\n`);

await new Promise(r => setTimeout(r, durationMs));

console.log(`\nDone. ${msgCount} message(s) captured.`);
rdp.destroy();
