/**
 * Captures reference frames from the YouTube player by:
 * 1. Starting a local HTTP server to receive canvas-captured PNGs
 * 2. For each timestamp, seeking the player via RDP then canvas-capturing to the server
 *
 * Usage: bun scripts/_capture-all-ref-frames.ts <t1> <t2> ... <tN>
 * Outputs: C:/Users/Avi/AppData/Local/Temp/ytdl-verify/frame_N_ref.png
 */
import { findFirefoxRdpPort, RDP } from "./firefox-rdp.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

import { TEMP_DIR } from "./script-config";
const PORT = 19234;
const SEEK_SETTLE_MS = 3_000;

mkdirSync(TEMP_DIR, { recursive: true });

const timestamps = process.argv.slice(2).map(Number);
if (!timestamps.length) {
  console.error("Usage: bun scripts/_capture-all-ref-frames.ts <t1> <t2> ...");
  process.exit(1);
}

const port = findFirefoxRdpPort();
if (!port) throw new Error("no Firefox RDP port");
const rdp = new RDP(port);
await rdp.connect();

const tabs = await rdp.listTabs();
const ytTab = tabs.find(tab => tab.url?.includes("youtube.com/watch"));
if (!ytTab) throw new Error("no YouTube watch tab");
const consoleActor = await rdp.getConsoleActor(ytTab.actor);
if (!consoleActor) throw new Error("no console actor");

let resolveFrame: ((buf: Buffer) => void) | null = null;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method === "POST") {
      const buf = Buffer.from(await req.arrayBuffer());
      resolveFrame?.(buf);
      return new Response("ok", { headers });
    }
    return new Response("ready", { headers });
  },
});

console.log("SERVER:listening on " + PORT);

const CANVAS_CAPTURE_JS = `(function() {
  var v = document.querySelector('#movie_player video') || document.querySelector('video');
  if (!v) { console.error('no video'); return; }
  var c = document.createElement('canvas');
  c.width = v.videoWidth || 1920;
  c.height = v.videoHeight || 1080;
  c.getContext('2d').drawImage(v, 0, 0);
  c.toBlob(function(blob) {
    blob.arrayBuffer().then(function(ab) {
      fetch('http://localhost:${PORT}', {
        method: 'POST',
        body: ab,
        headers: { 'Content-Type': 'image/png' }
      });
    });
  }, 'image/png');
})()`;

for (const [i, t] of timestamps.entries()) {
  console.log(`SEEK:${t}s (frame ${i + 1}/${timestamps.length})`);

  await rdp.evalInTab(consoleActor, `(function() {
    var p = document.querySelector('#movie_player');
    if (p && p.seekTo) p.seekTo(${t}, true);
    setTimeout(function() {
      var v = document.querySelector('#movie_player video') || document.querySelector('video');
      if (v) v.pause();
    }, 1500);
  })()`);

  await wait(SEEK_SETTLE_MS);

  const framePromise = new Promise<Buffer>(resolve => { resolveFrame = resolve; });

  await rdp.evalInTab(consoleActor, CANVAS_CAPTURE_JS);

  const frameTimeout = new Promise<null>(resolve => setTimeout(() => resolve(null), 8_000));
  const result = await Promise.race([framePromise, frameTimeout]);

  if (!result) {
    console.log(`TIMEOUT:frame ${i + 1} at t=${t}s`);
    continue;
  }

  const outPath = TEMP_DIR + "/frame_" + i + "_ref.png";
  writeFileSync(outPath, result);
  console.log(`SAVED:${outPath} bytes=${result.length}`);
}

server.stop();
rdp.destroy();
console.log("DONE");
