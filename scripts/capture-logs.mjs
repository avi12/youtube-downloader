/**
 * capture-logs.mjs
 *
 * Attaches Runtime.consoleAPICalled + Runtime.exceptionThrown listeners to the
 * project's service worker and offscreen page, prints messages until the
 * subprocess is killed (or until --duration ms elapses).
 *
 * Usage: node scripts/capture-logs.mjs [port] [durationSec]
 */

import WebSocket from "ws";

const PORT = Number(process.argv[2] ?? 9229);
const DURATION_MS = Number(process.argv[3] ?? 60) * 1000;

function openSocket(url) {
  return new Promise((res, rej) => {
    const s = new WebSocket(url);
    s.onopen = () => res(s);
    s.onerror = e => rej(e);
  });
}

function send(s, id, method, params = {}) {
  s.send(JSON.stringify({ id, method, params }));
}

async function attach(target, label) {
  if (!target) {
    console.log(`[${label}] target not found`);
    return null;
  }
  const sock = await openSocket(target.webSocketDebuggerUrl);
  send(sock, 1, "Runtime.enable");
  send(sock, 2, "Log.enable");
  sock.on("message", raw => {
    try {
      const m = JSON.parse(String(raw));
      if (m.method === "Runtime.consoleAPICalled") {
        const args = (m.params?.args ?? [])
          .map(a => a.value !== undefined ? a.value : a.description ?? JSON.stringify(a))
          .join(" ");
        console.log(`[${label}][${m.params?.type}] ${args}`);
      } else if (m.method === "Runtime.exceptionThrown") {
        const d = m.params?.exceptionDetails;
        console.log(`[${label}][EX] ${d?.exception?.description ?? d?.text ?? "?"}`);
      } else if (m.method === "Log.entryAdded") {
        const e = m.params?.entry;
        console.log(`[${label}][log:${e?.level}] ${e?.text}`);
      }
    } catch {}
  });
  return sock;
}

(async () => {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  const sw = targets.find(t => t.type === "service_worker" && (t.url ?? "").includes("iakmamcpgldfjjbeamagdkelogmokjpj"));
  const off = targets.find(t => (t.url ?? "").includes("offscreen.html"));
  const yt = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));

  const socks = await Promise.all([
    attach(sw, "SW"),
    attach(off, "OFFSCREEN"),
    attach(yt, "YT")
  ]);

  setTimeout(() => {
    for (const s of socks) if (s) s.close();
    process.exit(0);
  }, DURATION_MS);
})();
