// WebSocket log sink for the extension's BG SW + content scripts in dev mode.
// Run: `bun scripts/bg-log-listener.ts`
// Extension's BG SW connects to ws://localhost:9876 and streams every log it
// emits. No MCP required to see BG/console output.
import { serve } from "bun";

const PORT = 9876;

function nowStamp(timestamp?: number) {
  return new Date(timestamp ?? Date.now()).toLocaleTimeString();
}

serve({
  port: PORT,
  fetch(req, srv) {
    if (srv.upgrade(req)) {
      return;
    }

    return new Response("ytdl debug log sink — connect via WebSocket", { status: 200 });
  },
  websocket: {
    open() {
      console.log(`[${nowStamp()}] [sink] client connected`);
    },
    message(_ws, msg) {
      const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
      try {
        const parsed = JSON.parse(text);
        const tag = parsed.source ?? "log";
        const level = parsed.level ?? "info";
        const body = parsed.msg ?? text;
        console.log(`[${nowStamp(parsed.ts)}] [${tag}/${level}] ${body}`);
      } catch {
        console.log(text);
      }
    },
    close() {
      console.log(`[${nowStamp()}] [sink] client disconnected`);
    }
  }
});

console.log(`ytdl bg log sink listening on ws://localhost:${PORT}`);
console.log("waiting for the extension's BG SW to connect…");
console.log(`(if no connection, open about:debugging → inspect ext SW → make sure dev build is loaded)`);
