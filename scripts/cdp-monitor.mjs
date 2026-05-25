import WebSocket from "ws";

const wsUrl = process.argv[2];
const durationMs = parseInt(process.argv[3] ?? "30000", 10);
const ws = new WebSocket(wsUrl);

ws.on("open", () => {
  ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
  ws.send(JSON.stringify({ id: 2, method: "Log.enable" }));
});

ws.on("message", d => {
  const m = JSON.parse(String(d));
  if (m.method === "Runtime.consoleAPICalled") {
    const args = m.params.args.map(a => a.value ?? a.description ?? JSON.stringify(a.preview ?? {})).join(" ");
    console.log(`[${m.params.type}]`, args);
  } else if (m.method === "Log.entryAdded") {
    const e = m.params.entry;
    console.log(`[${e.level}]`, e.text);
  } else if (m.method === "Runtime.exceptionThrown") {
    const e = m.params.exceptionDetails;
    console.log("[EX]", e.exception?.description ?? e.text);
  }
});

setTimeout(() => process.exit(0), durationMs);
