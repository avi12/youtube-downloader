/**
 * Firefox Marionette client.
 * Connects to Firefox's Marionette port (2828) to execute JS in tabs.
 *
 * Usage:
 *   bun scripts/firefox-marionette-eval.ts eval "<expression>"
 *   bun scripts/firefox-marionette-eval.ts goto <url>
 *   bun scripts/firefox-marionette-eval.ts windows
 *
 * Marionette protocol: TCP, messages are `<length>:<JSON>` (same framing as RDP).
 * Each command is a 4-tuple [0, msgId, name, params].
 * Responses are [1, msgId, err, result].
 */
import { connect, type Socket } from "node:net";

const MARIONETTE_PORT = 2828;

type MarionetteResponse = [type: number, msgId: number, error: unknown, result: unknown];

class MarionetteClient {
  private socket: Socket;
  private buffer = Buffer.alloc(0);
  private nextMsgId = 1;
  private pending = new Map<number, (resp: MarionetteResponse) => void>();
  private ready: Promise<void>;

  constructor(port = MARIONETTE_PORT) {
    this.socket = connect(port, "127.0.0.1");
    this.ready = new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      this.socket.once("error", onError);
      this.socket.once("connect", () => {
        this.socket.off("error", onError);
        resolve();
      });
    });
    this.socket.on("data", chunk => this.handleData(chunk));
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const colonIdx = this.buffer.indexOf(":");
      if (colonIdx === -1) {
        return;
      }
      const len = parseInt(this.buffer.subarray(0, colonIdx).toString(), 10);
      if (!Number.isFinite(len) || this.buffer.length < colonIdx + 1 + len) {
        return;
      }
      const payload = this.buffer.subarray(colonIdx + 1, colonIdx + 1 + len).toString();
      this.buffer = this.buffer.subarray(colonIdx + 1 + len);

      const msg = JSON.parse(payload);
      // First message is the server hello: {"applicationType":"gecko",...}
      if (Array.isArray(msg)) {
        const resp = msg as MarionetteResponse;
        const handler = this.pending.get(resp[1]);
        if (handler) {
          this.pending.delete(resp[1]);
          handler(resp);
        }
      }
    }
  }

  async send<T = unknown>(name: string, params: Record<string, unknown> = {}): Promise<T> {
    await this.ready;
    const id = this.nextMsgId++;
    const cmd = [0, id, name, params];
    const text = JSON.stringify(cmd);
    const framed = `${text.length}:${text}`;
    this.socket.write(framed);

    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, ([, , err, result]) => {
        if (err) {
          reject(new Error(`Marionette error: ${JSON.stringify(err)}`));
        } else {
          resolve(result as T);
        }
      });
    });
  }

  close() {
    this.socket.destroy();
  }
}

async function startSession(client: MarionetteClient) {
  const result = await client.send("WebDriver:NewSession", { capabilities: {} });
  return result;
}

async function getWindows(client: MarionetteClient) {
  const resp = await client.send<string[] | { value: string[] }>("WebDriver:GetWindowHandles");
  return Array.isArray(resp) ? resp : resp.value;
}

async function switchWindow(client: MarionetteClient, handle: string) {
  return client.send("WebDriver:SwitchToWindow", { name: handle, handle });
}

async function getCurrentUrl(client: MarionetteClient) {
  const resp = await client.send<{ value: string }>("WebDriver:GetCurrentURL");
  return resp.value;
}

async function findYouTubeWatchWindow(client: MarionetteClient) {
  const handles = await getWindows(client);
  for (const h of handles) {
    await switchWindow(client, h);
    const url = await getCurrentUrl(client);
    if (url.includes("youtube.com/watch") || url.includes("youtube.com/feed")) {
      return { handle: h, url };
    }
  }
  return null;
}

async function evalInTab(client: MarionetteClient, expression: string) {
  const tab = await findYouTubeWatchWindow(client);
  if (!tab) {
    throw new Error("No YouTube tab found");
  }
  console.log(`Using tab: ${tab.url}`);
  return client.send("WebDriver:ExecuteAsyncScript", {
    script: expression,
    args: [],
    scriptTimeout: 30000
  });
}

async function gotoUrl(client: MarionetteClient, url: string) {
  const tab = await findYouTubeWatchWindow(client);
  if (!tab) {
    throw new Error("No YouTube tab found");
  }
  await client.send("WebDriver:Navigate", { url });
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const client = new MarionetteClient();

  try {
    await startSession(client);

    if (cmd === "open") {
      const [url] = args;
      await client.send("WebDriver:NewWindow", { type: "tab", focus: true });
      await new Promise(r => setTimeout(r, 500));
      await client.send("WebDriver:Navigate", { url });
      console.log("opened", url);
      return;
    }

    if (cmd === "windows") {
      const handles = await getWindows(client);
      for (const h of handles) {
        await switchWindow(client, h);
        const url = await getCurrentUrl(client);
        console.log(`${h} -> ${url}`);
      }
      return;
    }

    if (cmd === "goto") {
      const [url] = args;
      if (!url) {
        console.error("Usage: goto <url>");
        return;
      }
      await gotoUrl(client, url);
      console.log("Navigated");
      return;
    }

    if (cmd === "reload-ext") {
      try {
        await client.send("Addon:Uninstall", { id: "youtube-downloader@avi12.com" });
      } catch (e) {
        console.log("Uninstall (ignored):", String(e));
      }
      const path = args[0] ?? "C:\\repositories\\avi\\youtube-downloader\\.output\\firefox-mv3";
      const result = await client.send("Addon:Install", {
        path,
        temporary: true
      });
      console.log("Install result:", JSON.stringify(result));
      return;
    }

    if (cmd === "key") {
      const key = args[0];
      if (!key) throw new Error("Usage: key <keyName>");
      const tab = await findYouTubeWatchWindow(client);
      if (!tab) throw new Error("No YouTube tab");
      await switchWindow(client, tab.handle);
      await client.send("WebDriver:PerformActions", {
        actions: [{
          type: "key",
          id: "kbd",
          actions: [
            { type: "keyDown", value: key },
            { type: "keyUp", value: key }
          ]
        }]
      });
      console.log(`pressed ${key}`);
      return;
    }

    if (cmd === "click") {
      const selector = args.join(" ");
      const tab = await findYouTubeWatchWindow(client);
      if (!tab) throw new Error("No YouTube tab");
      await switchWindow(client, tab.handle);
      const elResp = await client.send<{ value: Record<string, string> }>("WebDriver:FindElement", { using: "css selector", value: selector });
      const elRef = elResp.value;
      const refKey = Object.keys(elRef).find(k => k.includes("element"));
      const elementId = refKey ? elRef[refKey] : null;
      if (!elementId) throw new Error(`Cannot resolve element id from ${JSON.stringify(elRef)}`);
      await client.send("WebDriver:ElementClick", { id: elementId });
      console.log(`clicked ${selector}`);
      return;
    }

    if (cmd === "eval") {
      const expr = args.join(" ");
      if (!expr) {
        console.error("Usage: eval <expression>");
        return;
      }
      const wrapped = `${expr}\n.then(r => arguments[0](r), e => arguments[0]({__error: String(e), stack: e?.stack}));`;
      const result = await evalInTab(client, wrapped);
      console.log("Result:", JSON.stringify(result, null, 2));
      return;
    }

    console.error("Commands: windows | goto <url> | eval <expr>");
  } finally {
    client.close();
  }
}

void main();
