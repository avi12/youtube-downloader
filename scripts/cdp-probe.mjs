import WebSocket from "ws";

const wsUrl = process.argv[2];
const expression = process.argv[3];
const ws = new WebSocket(wsUrl);

ws.on("open", () => {
  ws.send(JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression, returnByValue: true, awaitPromise: true }
  }));
});
ws.on("message", d => {
  const m = JSON.parse(String(d));
  if (m.id === 1) {
    console.log(JSON.stringify(m.result, null, 2));
    process.exit(0);
  }
});
setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 30000);
