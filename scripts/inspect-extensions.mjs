import WebSocket from "ws";

const PORT = Number(process.argv[2] ?? 9229);

function openSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(wsUrl);
    s.onopen = () => resolve(s);
    s.onerror = e => reject(new Error(e.message ?? String(e)));
  });
}
function cdpSend(socket, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9);
    const onMsg = e => {
      const data = JSON.parse(String(e.data));
      if (data.id !== id) return;
      socket.removeEventListener("message", onMsg);
      if (data.error) reject(new Error(`${method}: ${data.error.message}`));
      else resolve(data.result);
    };
    socket.addEventListener("message", onMsg);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

(async () => {
  // Use a service_worker target — they have chrome.management
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const sw = targets.find(t => t.type === "service_worker" && (t.url ?? "").includes("iakmamcpgldfjjbeamagdkelogmokjpj"));
  if (!sw) { console.log("no project SW target"); return; }

  const s = await openSocket(sw.webSocketDebuggerUrl);
  try {
    const r = await cdpSend(s, "Runtime.evaluate", {
      expression: `
        new Promise(res => {
          chrome.management.getAll(exts => {
            res(exts.map(e => ({
              id: e.id,
              name: e.name,
              version: e.version,
              enabled: e.enabled,
              installType: e.installType,
              shortName: e.shortName
            })));
          });
        })
      `,
      returnByValue: true,
      awaitPromise: true
    });
    console.log(JSON.stringify(r.result?.value, null, 2));
  } finally { s.close(); }
})();
