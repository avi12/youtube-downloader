import { execSync } from "node:child_process";
import { connect, type Socket } from "node:net";

const SKIP_PORTS = new Set([2828, 9230]);

function findRdpPort() {
  const out = execSync(`powershell -NoProfile -Command "$ff=Get-Process firefox -EA 0; Get-NetTCPConnection -State Listen -EA 0 | ?{ $_.OwningProcess -in $ff.Id } | Select-Object -ExpandProperty LocalPort"`, { encoding: "utf8" });
  const ports = out.trim().split(/\s+/).map(Number).filter(Number.isFinite);
  return ports.find(p => !SKIP_PORTS.has(p) && p > 1024)!;
}

type Msg = Record<string, unknown> & { from?: string };

class C {
  s: Socket; buf = Buffer.alloc(0); q = new Map<string, Msg[]>(); w = new Map<string, ((m: Msg)=>void)[]>();
  constructor(p: number) { this.s = connect(p, "127.0.0.1"); this.s.on("data", c => this.h(c)); }
  h(c: Buffer) { this.buf = Buffer.concat([this.buf, c]); while (true) { const i = this.buf.indexOf(":"); if (i<0) {return;} const len = parseInt(this.buf.subarray(0,i).toString(),10); if (this.buf.length < i+1+len) {return;} const p = this.buf.subarray(i+1, i+1+len).toString(); this.buf = this.buf.subarray(i+1+len); const m: Msg = JSON.parse(p); const a = m.from; if (typeof a !== "string") {continue;} const ws = this.w.get(a); if (ws?.length) {ws.shift()!(m);} else { const q = this.q.get(a) ?? []; q.push(m); this.q.set(a, q); } } }
  async wait(a: string, t = 5000): Promise<Msg> { const q = this.q.get(a); if (q?.length) {return q.shift()!;} return new Promise((res, rej) => { const tm = setTimeout(() => rej(new Error("timeout " + a)), t); const ar = this.w.get(a) ?? []; ar.push(m => { clearTimeout(tm); res(m); }); this.w.set(a, ar); }); }
  send(m: Record<string, unknown>) { const p = JSON.stringify(m); this.s.write(`${p.length}:${p}`); }
  async req<T extends Msg = Msg>(a: string, b: Record<string, unknown>): Promise<T> { this.send({ to: a, ...b }); return await this.wait(a) as T; }
  close() { this.s.destroy(); }
}

async function main() {
  const port = findRdpPort();
  const c = new C(port);
  await c.wait("root");
  const addons = await c.req<Msg & { addons?: Array<{ actor?: string; id?: string }> }>("root", { type: "listAddons" });
  const addon = addons.addons?.find(a => a.id === "youtube-downloader@avi12.com");
  if (!addon?.actor) { console.error("addon not found"); process.exit(1); }
  const watcherResp = await c.req<Msg & { actor?: string }>(addon.actor, { type: "getWatcher" });
  const watcher = watcherResp.actor;
  if (!watcher) { console.error("no watcher"); process.exit(1); }

  await c.req(watcher, { type: "watchTargets", targetType: "frame" });
  await c.req(watcher, { type: "watchResources", resourceTypes: ["console-message", "error-message"] });

  const dur = parseInt(process.argv[2] ?? "30000", 10);
  const start = Date.now();
  console.log("Watching for", dur, "ms");
  while (Date.now() - start < dur) {
    for (const [actor, queue] of c.q) {
      while (queue.length) {
        const m = queue.shift()!;
        const r = m as { type?: string; resources?: Array<{ resourceType?: string; arguments?: unknown[]; level?: string; pageError?: { errorMessage?: string } }> };
        if (r.type === "resources-available-array") {
          // arguments shape: [ [resourceType, [resource,...]], ... ]
          const list = (m as { array?: Array<[string, unknown[]]> }).array;
          if (list) {
            for (const [, items] of list) {
              for (const item of items) {
                const ri = item as { resourceType?: string; arguments?: unknown[]; level?: string; pageError?: { errorMessage?: string }; message?: string; timeStamp?: number };
                if (ri.resourceType === "console-message") {
                  const args = (ri.arguments ?? []).map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
                  if (args.includes("ytdl")) {console.log("[" + ri.level + "]", args);}
                } else if (ri.resourceType === "error-message") {
                  const em = ri.pageError?.errorMessage ?? ri.message;
                  if (em && em.includes("ytdl")) {console.log("[error]", em);}
                }
              }
            }
          }
        }
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }
  c.close();
}
void main();
