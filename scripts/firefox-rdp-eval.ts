/**
 * Firefox RDP client that lists frames and evaluates JS in a given browsing context.
 * Usage:
 *   bun scripts/firefox-rdp-eval.ts list                           - list all targets/frames
 *   bun scripts/firefox-rdp-eval.ts eval <actorId> "<expression>"  - evaluate JS in a frame
 *
 * Finds Firefox's RDP TCP port by scanning Firefox's listening ports.
 * Skips known non-RDP ports (2828 = Marionette, 9230 = httpd.js placeholder).
 */
import { execSync } from "node:child_process";
import { connect, type Socket } from "node:net";

const SKIP_PORTS = new Set([2828, 9230]);

type RdpMessage = Record<string, unknown> & { from?: string };

function findFirefoxRdpPort() {
  const output = execSync(
    `powershell -NoProfile -Command "$ff=Get-Process firefox -EA 0; Get-NetTCPConnection -State Listen -EA 0 | ?{ $_.OwningProcess -in $ff.Id } | Select-Object -ExpandProperty LocalPort"`,
    { encoding: "utf8" }
  );
  const ports = output.trim().split(/\s+/).map(Number).filter(Number.isFinite);
  const candidate = ports.find(p => !SKIP_PORTS.has(p) && p > 1024);
  if (!candidate) {
    throw new Error(`No RDP port found. Firefox ports: ${ports.join(", ")}`);
  }
  return candidate;
}

class RdpClient {
  private socket: Socket;
  private buffer = Buffer.alloc(0);
  private queueByActor = new Map<string, RdpMessage[]>();
  private waitersByActor = new Map<string, ((msg: RdpMessage) => void)[]>();

  constructor(port: number) {
    this.socket = connect(port, "127.0.0.1");
    this.socket.on("data", chunk => this.handleData(chunk));
  }

  private handleData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const colonIdx = this.buffer.indexOf(":");
      if (colonIdx === -1) {
        return;
      }

      const lenStr = this.buffer.subarray(0, colonIdx).toString();
      const len = parseInt(lenStr, 10);
      if (!Number.isFinite(len)) {
        return;
      }
      if (this.buffer.length < colonIdx + 1 + len) {
        return;
      }

      const payload = this.buffer.subarray(colonIdx + 1, colonIdx + 1 + len).toString();
      this.buffer = this.buffer.subarray(colonIdx + 1 + len);

      const msg: RdpMessage = JSON.parse(payload);
      const actor = msg.from;
      if (typeof actor !== "string") {
        continue;
      }

      const waiters = this.waitersByActor.get(actor);
      if (waiters && waiters.length) {
        const handler = waiters.shift()!;
        handler(msg);
      } else {
        const queue = this.queueByActor.get(actor) ?? [];
        queue.push(msg);
        this.queueByActor.set(actor, queue);
      }
    }
  }

  async waitForFrom(actor: string, timeoutMs = 5000): Promise<RdpMessage> {
    const queue = this.queueByActor.get(actor);
    if (queue && queue.length) {
      return queue.shift()!;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${actor}`)), timeoutMs);
      const handler = (msg: RdpMessage) => {
        clearTimeout(timer);
        resolve(msg);
      };
      const arr = this.waitersByActor.get(actor) ?? [];
      arr.push(handler);
      this.waitersByActor.set(actor, arr);
    });
  }

  async waitForFromMatching(actor: string, predicate: (msg: RdpMessage) => boolean, timeoutMs = 5000): Promise<RdpMessage> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const remaining = timeoutMs - (Date.now() - start);
      const msg = await this.waitForFrom(actor, Math.max(remaining, 100));
      if (predicate(msg)) {
        return msg;
      }
    }
    throw new Error(`Timeout waiting for matching message from ${actor}`);
  }

  send(msg: Record<string, unknown>) {
    const payload = JSON.stringify(msg);
    const wrapped = `${payload.length}:${payload}`;
    this.socket.write(wrapped);
  }

  async request<T extends RdpMessage = RdpMessage>(actor: string, body: Record<string, unknown>): Promise<T> {
    this.send({
      to: actor,
      ...body
    });
    const msg = await this.waitForFrom(actor);
    return msg as T;
  }

  close() {
    this.socket.destroy();
  }
}

async function listTargets() {
  const port = findFirefoxRdpPort();
  console.log(`Using RDP port: ${port}`);
  const client = new RdpClient(port);

  const greeting = await client.waitForFrom("root");
  console.log("Greeting:", JSON.stringify(greeting));
  const tabsList = await client.request<RdpMessage & { tabs?: RdpMessage[] }>("root", { type: "listTabs" });
  console.log("listTabs raw:", JSON.stringify(tabsList));
  const addons = await client.request<RdpMessage & { addons?: RdpMessage[] }>("root", { type: "listAddons" });
  const processes = await client.request<RdpMessage & { processes?: RdpMessage[] }>("root", { type: "listProcesses" });

  console.log("\n== Tabs ==");
  for (const t of tabsList.tabs ?? []) {
    const x = t as { actor?: string; url?: string; title?: string };
    console.log(`  ${x.actor} | ${x.url ?? "?"} | ${x.title ?? "?"}`);
  }

  console.log("\n== Addons (extensions) ==");
  for (const a of addons.addons ?? []) {
    const x = a as { actor?: string; id?: string; name?: string; url?: string };
    console.log(`  ${x.actor} | ${x.id} | ${x.name} | ${x.url ?? ""}`);
  }

  console.log("\n== Processes ==");
  for (const p of processes.processes ?? []) {
    const x = p as { actor?: string; id?: number; parent?: boolean };
    console.log(`  ${x.actor} | pid=${x.id} | parent=${x.parent}`);
  }

  client.close();
}

async function evalInActor(urlMatch: string, expression: string) {
  const port = findFirefoxRdpPort();
  const client = new RdpClient(port);
  await client.waitForFrom("root");

  // Look up tab actor by URL match.
  const tabsList = await client.request<RdpMessage & {
    tabs?: Array<{ actor?: string; url?: string }>;
  }>("root", { type: "listTabs" });
  const tab = (tabsList.tabs ?? []).find(t => (t.url ?? "").includes(urlMatch));
  if (!tab?.actor) {
    console.error(`No tab matched ${urlMatch}. Tabs:`, (tabsList.tabs ?? []).map(t => t.url));
    client.close();
    return;
  }

  const actorId = tab.actor;
  const targetResp = await client.request<RdpMessage & {
    frame?: { consoleActor?: string };
    consoleActor?: string;
  }>(actorId, { type: "getTarget" });

  const consoleActor = targetResp.frame?.consoleActor ?? targetResp.consoleActor;
  if (!consoleActor) {
    console.error("No consoleActor returned. Target response:", JSON.stringify(targetResp).slice(0, 500));
    client.close();
    return;
  }

  const evalStart = await client.request<RdpMessage & { resultID?: string }>(consoleActor, {
    type: "evaluateJSAsync",
    text: expression,
    eager: false
  });
  const resultID = evalStart.resultID;
  if (!resultID) {
    console.error("evaluateJSAsync did not return a resultID:", JSON.stringify(evalStart));
    client.close();
    return;
  }

  // The console actor sends a follow-up evaluationResult message with the same resultID.
  const result = await client.waitForFromMatching(consoleActor, msg => {
    const r = msg as { resultID?: string; type?: string };
    return r.type === "evaluationResult" && r.resultID === resultID;
  }, 30_000);
  console.log(JSON.stringify(result, null, 2));

  client.close();
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "list") {
    await listTargets();
    return;
  }
  if (cmd === "eval") {
    const [actorId, expr] = args;
    if (!actorId || !expr) {
      console.error("Usage: eval <actorId> <expression>");
      process.exit(1);
    }
    await evalInActor(actorId, expr);
    return;
  }
  console.error("Commands: list | eval <actorId> <expression>");
  process.exit(1);
}

void main();
