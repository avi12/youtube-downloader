import WebSocket from "ws";

const PORT = Number(process.argv[2] ?? 9229);

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

function openSocket(wsUrl) {
  return new Promise((resolve, reject) => {
    const s = new WebSocket(wsUrl);
    s.onopen = () => resolve(s);
    s.onerror = e => reject(new Error(`ws open failed: ${e.message ?? e}`));
  });
}

async function evalOn(target, expression) {
  const socket = await openSocket(target.webSocketDebuggerUrl);
  try {
    const r = await cdpSend(socket, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { ex: r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails) };
    return r.result?.value;
  } finally {
    socket.close();
  }
}

(async () => {
  const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
  console.log("=== ALL TARGETS ===");
  for (const t of targets) console.log(`${t.type.padEnd(20)} ${(t.url ?? "").slice(0, 120)}`);

  const yt = targets.find(t => t.type === "page" && (t.url ?? "").includes("youtube.com/watch"));
  const dl = targets.find(t => t.type === "page" && (t.url ?? "").startsWith("chrome://downloads"));

  if (yt) {
    console.log("\n=== YT TAB: download button state ===");
    const btnState = await evalOn(yt, `
      (() => {
        const all = [...document.querySelectorAll('button')]
          .map(el => ({ aria: el.getAttribute('aria-label'), text: el.textContent?.trim()?.slice(0,40), id: el.id }))
          .filter(b => /download|stop|retry|failed/i.test((b.aria ?? "") + " " + (b.text ?? "")));
        return all;
      })()
    `);
    console.log(JSON.stringify(btnState, null, 2));

    console.log("\n=== YT TAB: watch-snackbar state ===");
    const snack = await evalOn(yt, `
      (() => {
        const host = document.querySelector('ytd-watch-flexy') ?? document.body;
        const snacks = [...host.querySelectorAll('*')].filter(el => el.tagName?.toLowerCase().includes('snack'));
        return snacks.map(s => ({ tag: s.tagName, text: s.textContent?.slice(0, 200) }));
      })()
    `);
    console.log(JSON.stringify(snack, null, 2));
  }

  if (dl) {
    console.log("\n=== DOWNLOADS TAB: items ===");
    const items = await evalOn(dl, `
      (async () => {
        const mgr = document.querySelector('downloads-manager');
        const list = mgr?.shadowRoot?.querySelector('iron-list');
        const items = list?.items ?? [];
        return items.slice(0, 10).map(it => ({
          id: it.id,
          state: it.state,
          danger_type: it.danger_type,
          percent: it.percent,
          file_name: it.file_name,
          last_reason_text: it.last_reason_text,
          received_bytes: it.received_bytes,
          total_bytes: it.total_bytes,
          since_string: it.since_string,
          date_string: it.date_string
        }));
      })()
    `);
    console.log(JSON.stringify(items, null, 2));
  } else {
    console.log("\n=== No chrome://downloads tab open ===");
  }
})().catch(e => { console.error("inspect error:", e); process.exit(2); });
