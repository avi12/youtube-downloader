import http from "http";
import WebSocket from "ws";
import { setTimeout as sleep } from "timers/promises";

const data: any[] = await new Promise((res) => {
  http.get("http://localhost:9229/json", (r) => {
    let d = "";
    r.on("data", (c) => (d += c));
    r.on("end", () => res(JSON.parse(d)));
  });
});

const tab = data.find((t) => t.type === "page" && t.url?.includes("CjYRBfKlgro"));
const sw = data.find((t) => t.type === "service_worker" && t.url?.includes("iakmamcpgldfjjbeamagdkelogmokjpj"));
const offscreen = data.find((t) => t.url?.includes("offscreen.html"));

if (!tab) { console.error("Watch tab not found"); process.exit(1); }
if (!sw) { console.error("SW not found"); process.exit(1); }

function evalCDP(wsUrl: string, expr: string, awaitPromise = false): Promise<any> {
  return new Promise((res) => {
    const s = new WebSocket(wsUrl);
    s.on("open", () => s.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise, returnByValue: true } })));
    s.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) { s.close(); res(msg.result?.result?.value ?? msg.result?.result?.description ?? null); }
    });
    s.on("error", () => res(null));
    setTimeout(() => { s.close(); res("timeout"); }, 10000);
  });
}

// Clean OPFS orphans
if (offscreen) {
  await evalCDP(offscreen.webSocketDebuggerUrl, `
    (async () => {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) {
        if (name.includes('video-stream') || name.includes('mux-out')) {
          await root.removeEntry(name).catch(()=>{});
        }
      }
    })()
  `, true);
  console.log("OPFS cleaned");
}

// Reload page
console.log("Reloading page...");
await new Promise<void>((res) => {
  const s = new WebSocket(tab.webSocketDebuggerUrl);
  s.on("open", () => s.send(JSON.stringify({ id: 1, method: "Page.reload" })));
  s.on("message", (raw) => { const msg = JSON.parse(String(raw)); if (msg.id === 1) { s.close(); res(); } });
  s.on("error", () => res());
});
await sleep(5000);
console.log("Page reloaded");

// Set up log monitoring BEFORE clicking (to catch all events)
const start = Date.now();
const t = () => ((Date.now() - start) / 1000).toFixed(0) + "s";

const swSock = new WebSocket(sw.webSocketDebuggerUrl);
swSock.on("open", () => swSock.send(JSON.stringify({ id: 1, method: "Runtime.enable" })));
swSock.on("message", (raw) => {
  const msg = JSON.parse(String(raw));
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = (msg.params?.args ?? []).map((a: any) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
    process.stdout.write(`[${t()}][SW] ${text}\n`);
  }
  if (msg.method === "Runtime.exceptionThrown") {
    const d = msg.params?.exceptionDetails;
    process.stdout.write(`[${t()}][SW][EX] ${d?.exception?.description ?? d?.text ?? "?"}\n`);
  }
});
swSock.on("error", () => {});

const offSock = offscreen ? new WebSocket(offscreen.webSocketDebuggerUrl) : null;
if (offSock) {
  offSock.on("open", () => offSock.send(JSON.stringify({ id: 1, method: "Runtime.enable" })));
  offSock.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params?.args ?? []).map((a: any) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
      process.stdout.write(`[${t()}][OFF] ${text}\n`);
    }
  });
  offSock.on("error", () => {});
}

await sleep(2000); // let monitoring settle

// Click download button to open panel
console.log("Opening panel...");
const openResult = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const btn = document.querySelector('.ytdl-download-button');
    if (!btn) return 'panel button not found';
    btn.click();
    return 'panel opened';
  })()
`);
console.log("Panel:", openResult);
await sleep(2000);

// Check current type state and find type trigger button
const stateCheck = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    // Find type trigger button (#type-select)
    const typeTrigger = document.getElementById('type-select');
    const typeValue = typeTrigger?.querySelector('.value')?.textContent?.trim();

    // Find popover
    const popup = document.getElementById('ytdl-select-popup-type-select');
    const popupVisible = popup?.matches(':popover-open');

    // Find paper-items with data-value
    const items = Array.from(document.querySelectorAll('tp-yt-paper-item[data-value]'));
    const itemInfo = items.map(el => JSON.stringify({
      text: el.textContent?.trim(),
      value: el.getAttribute('data-value')
    }));

    return JSON.stringify({
      typeValue,
      typeTriggerFound: !!typeTrigger,
      popupVisible,
      popupFound: !!popup,
      items: itemInfo
    });
  })()
`);
console.log("State:", stateCheck);
await sleep(500);

// Click type trigger button to open type dropdown
console.log("Opening type dropdown...");
const triggerResult = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const typeTrigger = document.getElementById('type-select');
    if (!typeTrigger) {
      // Try by aria-label
      const btn = document.querySelector('[aria-label="Type"]');
      if (!btn) return 'type trigger not found';
      btn.click();
      return 'clicked via aria-label';
    }
    typeTrigger.click();
    return 'clicked type trigger';
  })()
`);
console.log("Trigger:", triggerResult);
await sleep(600);

// Check if popover is open, then click Video+Audio item
const selectResult = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const popup = document.querySelector('.ytdl-select-popup:popover-open, [id^="ytdl-select-popup"]:popover-open');
    const popoverOpen = !!popup;

    const items = Array.from(document.querySelectorAll('tp-yt-paper-item[data-value]'));
    const vaItem = items.find(el => el.getAttribute('data-value') === 'video+audio');

    if (!vaItem) {
      return JSON.stringify({ error: 'video+audio item not found', itemCount: items.length, popoverOpen });
    }

    // Click it - this should bubble to the listbox and trigger onchange
    vaItem.click();
    return JSON.stringify({ clicked: true, dataValue: vaItem.getAttribute('data-value'), text: vaItem.textContent?.trim(), popoverOpen });
  })()
`);
console.log("Select Video+Audio:", selectResult);
await sleep(1000);

// Verify the type changed
const typeCheck = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const typeTrigger = document.getElementById('type-select');
    const typeValue = typeTrigger?.querySelector('.value')?.textContent?.trim();
    return JSON.stringify({ typeValue });
  })()
`);
console.log("Type after selection:", typeCheck);

// If type didn't change, try direct approach via popovertarget button
const parsed = JSON.parse(typeCheck || "{}");
if (parsed.typeValue !== "Video + Audio") {
  console.log("Type didn't change, trying to open popover manually...");

  const reopenResult = await evalCDP(tab.webSocketDebuggerUrl, `
    (() => {
      // Find popover and force show it
      const popups = Array.from(document.querySelectorAll('[id^="ytdl-select-popup"]'));
      const result = popups.map(p => ({ id: p.id, open: p.matches(':popover-open') }));

      // Try showPopover on the type one
      if (popups[0]) {
        try { popups[0].showPopover(); return 'showPopover called on ' + popups[0].id; }
        catch(e) { return 'showPopover error: ' + e.message; }
      }
      return JSON.stringify(result);
    })()
  `);
  console.log("Reopen attempt:", reopenResult);
  await sleep(500);

  const reClickResult = await evalCDP(tab.webSocketDebuggerUrl, `
    (() => {
      const items = Array.from(document.querySelectorAll('tp-yt-paper-item[data-value]'));
      const vaItem = items.find(el => el.getAttribute('data-value') === 'video+audio');
      if (!vaItem) return 'not found';
      vaItem.click();
      return 'clicked: ' + JSON.stringify({ dv: vaItem.getAttribute('data-value'), text: vaItem.textContent?.trim() });
    })()
  `);
  console.log("Re-click:", reClickResult);
  await sleep(800);
}

// Final type check
const finalType = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const typeTrigger = document.getElementById('type-select');
    const typeValue = typeTrigger?.querySelector('.value')?.textContent?.trim();
    const qualTrigger = document.getElementById('quality-select');
    const qualValue = qualTrigger?.querySelector('.value')?.textContent?.trim();
    return JSON.stringify({ typeValue, qualValue });
  })()
`);
console.log("Final panel state:", finalType);

// Select 1080p quality if needed (click quality trigger then select)
console.log("Selecting 1080p quality...");
await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const qualTrigger = document.getElementById('quality-select');
    qualTrigger?.click();
  })()
`);
await sleep(600);

const qualResult = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const items = Array.from(document.querySelectorAll('tp-yt-paper-item[data-value]'));
    const q1080 = items.find(el => {
      const txt = el.textContent?.trim() ?? '';
      return txt.includes('1080') && txt.includes('30');
    });
    if (!q1080) return 'not found, available: ' + items.map(i => i.getAttribute('data-value')).join(',');
    q1080.click();
    return 'clicked: ' + q1080.textContent?.trim();
  })()
`);
console.log("Quality:", qualResult);
await sleep(800);

// Click Download button
console.log("Clicking Download...");
const dlResult = await evalCDP(tab.webSocketDebuggerUrl, `
  (() => {
    const btns = Array.from(document.querySelectorAll('button, tp-yt-paper-button'));
    const dlBtn = btns.find(b => b.textContent?.trim() === 'Download');
    if (!dlBtn) return 'not found, buttons: ' + btns.map(b => b.textContent?.trim()).filter(Boolean).join(' | ');
    dlBtn.click();
    return 'clicked';
  })()
`);
console.log("Download button:", dlResult);

// Monitor for 400s
console.log("\n=== Monitoring for 400s ===");
let done = false;
const iv = setInterval(async () => {
  if (done || !offscreen) return;
  try {
    const s = new WebSocket(offscreen.webSocketDebuggerUrl);
    s.on("open", () => s.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: {
      expression: `(async () => {
        const root = await navigator.storage.getDirectory();
        const files = [];
        for await (const [name, h] of root.entries()) {
          if (h.kind === 'file') { const f = await h.getFile(); files.push(name+':'+(f.size/1e6).toFixed(1)+'MB'); }
        }
        return files.join(', ') || 'empty';
      })()`,
      awaitPromise: true, returnByValue: true
    }})));
    s.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.id === 1) { s.close(); process.stdout.write(`[${t()}][OPFS] ${msg.result?.result?.value ?? "err"}\n`); }
    });
    s.on("error", () => {});
    setTimeout(() => s.close(), 6000);
  } catch { }
}, 30000);

await sleep(400000);
done = true;
clearInterval(iv);
swSock.close();
offSock?.close();
console.log("Done 400s");
