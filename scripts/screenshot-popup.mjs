import http from "node:http";
import WebSocket from "ws";
import { writeFileSync } from "node:fs";

const CDP_PORT = 9229;
const EXTENSION_ID = "iakmamcpgldfjjbeamagdkelogmokjpj";
const POPUP_URL = `chrome-extension://${EXTENSION_ID}/popup.html`;
const OUTPUT_PATH = process.argv[2] ?? "scripts/popup-current.png";
const WIDTH = 400;
const HEIGHT = 620;

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${CDP_PORT}${path}`, response => {
      let body = "";
      response.on("data", chunk => body += chunk);
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Non-JSON response from ${path}: ${body.slice(0, 200)}`));
        }
      });
      response.on("error", reject);
    }).on("error", reject);
  });
}

function withSocket(wsUrl, fn) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let messageId = 0;
    const pending = new Map();
    socket.on("message", raw => {
      const msg = JSON.parse(String(raw));
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve: r1, reject: r2 } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) {
          r2(new Error(JSON.stringify(msg.error)));
        } else {
          r1(msg.result);
        }
      }
    });
    socket.on("open", async () => {
      function send(method, params = {}) {
        const id = ++messageId;
        return new Promise((r1, r2) => {
          pending.set(id, { resolve: r1, reject: r2 });
          socket.send(JSON.stringify({ id, method, params }));
        });
      }

      try {
        const result = await fn(send);
        socket.close();
        resolve(result);
      } catch (error) {
        socket.close();
        reject(error);
      }
    });
    socket.on("error", reject);
  });
}

async function closeStalePopups() {
  const targets = await fetchJson("/json");
  const stale = targets.filter(t =>
    t.type === "page" && (t.url ?? "").includes(`${EXTENSION_ID}/popup.html`)
  );
  for (const t of stale) {
    await fetchJson(`/json/close/${t.id}`).catch(() => {});
  }
  console.log(`Closed ${stale.length} stale popup target(s)`);
}

async function getBrowserWsUrl() {
  const version = await fetchJson("/json/version");
  return version.webSocketDebuggerUrl;
}

async function createPopupTarget(browserWsUrl) {
  return await withSocket(browserWsUrl, async send => {
    const { targetId } = await send("Target.createTarget", {
      url: POPUP_URL,
      width: WIDTH,
      height: HEIGHT,
      newWindow: true
    });
    return targetId;
  });
}

async function screenshotTarget(targetId) {
  await new Promise(r => setTimeout(r, 1500));
  const targets = await fetchJson("/json");
  const target = targets.find(t => t.id === targetId);
  if (!target) {
    throw new Error(`Target ${targetId} not found post-create`);
  }

  return await withSocket(target.webSocketDebuggerUrl, async send => {
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 2,
      mobile: false
    });
    await new Promise(r => setTimeout(r, 600));
    const { data } = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true
    });
    return data;
  });
}

await closeStalePopups();
const browserWsUrl = await getBrowserWsUrl();
console.log("Browser WS:", browserWsUrl);
const targetId = await createPopupTarget(browserWsUrl);
console.log("Opened popup target:", targetId);
const png = await screenshotTarget(targetId);
writeFileSync(OUTPUT_PATH, Buffer.from(png, "base64"));
console.log(`Saved ${OUTPUT_PATH}`);
await fetchJson(`/json/close/${targetId}`).catch(() => {});
console.log("Closed popup target");
