import WebSocket from "ws";

const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error("usage: node dump-page-full.mjs <wsDebuggerUrl> [durationMs]");
  process.exit(1);
}

const durationMs = Number(process.argv[3] ?? 6000);
const ws = new WebSocket(wsUrl);
let id = 0;

function emit(line) {
  process.stdout.write(line + "\n");
}

ws.on("open", () => {
  ws.send(JSON.stringify({ id: ++id, method: "Log.enable" }));
  ws.send(JSON.stringify({ id: ++id, method: "Runtime.enable" }));
  ws.send(JSON.stringify({ id: ++id, method: "Network.enable" }));
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
      emit("[console:" + msg.params.type + "] " + args);
    }
    if (msg.method === "Log.entryAdded") {
      emit("[log:" + msg.params.entry.level + "] " + msg.params.entry.text);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      emit("[exception] " + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
    if (msg.method === "Network.requestWillBeSent") {
      const u = msg.params.request.url;
      if (u.includes("googlevideo") || u.includes("youtubei") || u.includes("chrome-extension")) {
        emit("[net:req] " + msg.params.request.method + " " + u.slice(0, 200));
      }
    }
    if (msg.method === "Network.responseReceived") {
      const u = msg.params.response.url;
      if (u.includes("googlevideo") || u.includes("youtubei") || u.includes("chrome-extension")) {
        emit("[net:res] " + msg.params.response.status + " " + u.slice(0, 200));
      }
    }
    if (msg.method === "Network.loadingFailed") {
      emit("[net:fail] " + msg.params.errorText + " | type=" + msg.params.type);
    }
  } catch {}
});

ws.on("error", err => {
  emit("ws error: " + err.message);
});

setTimeout(() => process.exit(0), durationMs);
