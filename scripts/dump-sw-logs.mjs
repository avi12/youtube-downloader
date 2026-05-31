import WebSocket from "ws";

const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error("usage: node dump-sw-logs.mjs <wsDebuggerUrl> [durationMs]");
  process.exit(1);
}

const durationMs = Number(process.argv[3] ?? 4000);
const ws = new WebSocket(wsUrl);
let id = 0;

function emit(line) {
  process.stdout.write(line + "\n");
}

ws.on("open", () => {
  ws.send(JSON.stringify({ id: ++id, method: "Log.enable" }));
  ws.send(JSON.stringify({ id: ++id, method: "Runtime.enable" }));
});

ws.on("message", data => {
  try {
    const msg = JSON.parse(String(data));
    if (msg.method === "Runtime.consoleAPICalled") {
      const args = (msg.params.args || []).map(a => {
        if (a.type === "string") {return a.value;}
        if (a.type === "object") {return a.description || JSON.stringify(a.preview || {});}
        return a.value ?? a.description ?? "";
      }).join(" ");
      emit("[" + msg.params.type + "] " + args);
    }
    if (msg.method === "Log.entryAdded") {
      emit("[" + msg.params.entry.level + "] " + msg.params.entry.text);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      emit("[exception] " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
  } catch {}
});

ws.on("error", err => {
  emit("ws error: " + err.message);
});

setTimeout(() => process.exit(0), durationMs);
