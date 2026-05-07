/**
 * Starts a local HTTP server that receives a PNG blob POSTed from the YouTube
 * tab, saves it, then exits. Run alongside _capture-frame-rdp.ts.
 */
import { writeFileSync } from "node:fs";

import { join } from "node:path";
import { TEMP_DIR } from "./script-config";

const outPath = process.argv[2] ?? join(TEMP_DIR, "ref_frame.png");
const PORT = 19234;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const headers = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    });
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (req.method === "POST") {
      const buf = await req.arrayBuffer();
      writeFileSync(outPath, Buffer.from(buf));
      console.log("SAVED:" + outPath + " bytes=" + buf.byteLength);
      server.stop();
      return new Response("ok", { headers });
    }
    return new Response("ready", { headers });
  }
});

console.log("LISTENING:" + PORT);
// Timeout after 15s
setTimeout(() => { console.log("TIMEOUT"); server.stop(); }, 15_000);
