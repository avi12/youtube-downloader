import { connect } from "node:net";

const [, , portArg, cmd, ...rest] = process.argv;
const port = Number(portArg);

class C {
  constructor(p) {
    this.buf = Buffer.alloc(0);
    this.q = new Map();
    this.w = new Map();
    this.s = connect(p, "127.0.0.1");
    this.s.on("data", c => this.h(c));
  }
  h(c) {
    this.buf = Buffer.concat([this.buf, c]);
    while (true) {
      const i = this.buf.indexOf(":");
      if (i < 0) return;
      const len = parseInt(this.buf.subarray(0, i).toString(), 10);
      if (this.buf.length < i + 1 + len) return;
      const m = JSON.parse(this.buf.subarray(i + 1, i + 1 + len).toString());
      this.buf = this.buf.subarray(i + 1 + len);
      const a = m.from;
      if (typeof a !== "string") continue;
      const ws = this.w.get(a);
      if (ws?.length) ws.shift()(m);
      else {
        const q = this.q.get(a) ?? [];
        q.push(m);
        this.q.set(a, q);
      }
    }
  }
  async wait(a, t = 20000) {
    const q = this.q.get(a);
    if (q?.length) return q.shift();
    return new Promise((res, rej) => {
      const tm = setTimeout(() => rej(new Error("timeout waiting for " + a)), t);
      const ar = this.w.get(a) ?? [];
      ar.push(m => { clearTimeout(tm); res(m); });
      this.w.set(a, ar);
    });
  }
  send(m) {
    const p = JSON.stringify(m);
    this.s.write(`${p.length}:${p}`);
  }
  async req(a, b) {
    this.send({ to: a, ...b });
    return await this.wait(a);
  }
  close() { this.s.destroy(); }
}

const c = new C(port);
await c.wait("root");

if (cmd === "addons") {
  const addons = await c.req("root", { type: "listAddons" });
  console.log(JSON.stringify((addons.addons ?? []).map(a => ({ id: a.id, temp: a.temporarilyInstalled, url: a.url?.slice(0, 80) })), null, 1));
}

if (cmd === "tabs") {
  const tabs = await c.req("root", { type: "listTabs" });
  console.log(JSON.stringify((tabs.tabs ?? []).map(t => ({ actor: t.actor, title: t.title?.slice(0, 50), url: t.url?.slice(0, 70) })), null, 1));
}

if (cmd === "eval") {
  const [tabUrlSubstring, expr] = rest;
  const tabs = await c.req("root", { type: "listTabs" });
  const tab = (tabs.tabs ?? []).find(t => (t.url ?? "").includes(tabUrlSubstring));
  if (!tab) {
    console.log("no tab matching", tabUrlSubstring);
    process.exit(1);
  }
  const target = await c.req(tab.actor, { type: "getTarget" });
  const consoleActor = target.frame?.consoleActor;
  if (!consoleActor) {
    console.log("no consoleActor in", JSON.stringify(target).slice(0, 300));
    process.exit(1);
  }
  const resp = await c.req(consoleActor, { type: "evaluateJSAsync", text: expr });
  const result = resp.resultID ? await c.wait(consoleActor, 60000) : resp;
  console.log(JSON.stringify(result.result ?? result.exception ?? result).slice(0, 4000));
}

if (cmd === "nav") {
  const [tabUrlSubstring, targetUrl] = rest;
  const tabs = await c.req("root", { type: "listTabs" });
  const tab = (tabs.tabs ?? []).find(t => (t.url ?? "").includes(tabUrlSubstring));
  if (!tab) {
    console.log("no tab matching", tabUrlSubstring);
    process.exit(1);
  }
  const target = await c.req(tab.actor, { type: "getTarget" });
  const frameActor = target.frame?.actor;
  const resp = await c.req(frameActor, { type: "navigateTo", url: targetUrl });
  console.log("nav result:", JSON.stringify(resp).slice(0, 200));
}

if (cmd === "addon-eval") {
  const [expr] = rest;
  const addons = await c.req("root", { type: "listAddons" });
  const addon = (addons.addons ?? []).find(a => a.id === "youtube-downloader@avi12.com");
  if (!addon) {
    console.log("addon not found");
    process.exit(1);
  }
  const watcherResp = await c.req(addon.actor, { type: "getWatcher" });
  const watcher = watcherResp.actor;
  c.send({ to: watcher, type: "watchTargets", targetType: "frame" });
  const targets = [];
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    let msg;
    try {
      msg = await c.wait(watcher, 3000);
    } catch {
      break;
    }
    if (msg.type === "target-available-form" && msg.target?.consoleActor) {
      targets.push({ url: msg.target.url, consoleActor: msg.target.consoleActor });
    }
  }
  console.log("targets:", JSON.stringify(targets.map(t => t.url?.slice(0, 80))));
  const bgTarget = targets.find(t => /background/.test(t.url ?? "")) ?? targets.find(t => /^moz-extension:/.test(t.url ?? ""));
  const consoleActor = bgTarget?.consoleActor;
  if (!consoleActor) {
    console.log("no background target found");
    process.exit(1);
  }
  const resp = await c.req(consoleActor, { type: "evaluateJSAsync", text: expr });
  const result = resp.resultID ? await c.wait(consoleActor, 60000) : resp;
  console.log("FULL:", JSON.stringify(result).slice(0, 2000));
}

if (cmd === "popup-measure") {
  const addons = await c.req("root", { type: "listAddons" });
  const addon = (addons.addons ?? []).find(a => a.id === "youtube-downloader@avi12.com");
  const watcherResp = await c.req(addon.actor, { type: "getWatcher" });
  const watcher = watcherResp.actor;
  c.send({ to: watcher, type: "watchTargets", targetType: "frame" });

  const targets = [];
  function drainTargets(ms) {
    return (async () => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        let msg;
        try { msg = await c.wait(watcher, ms); } catch { break; }
        if (msg.type === "target-available-form" && msg.target?.consoleActor) {
          targets.push({ url: msg.target.url, consoleActor: msg.target.consoleActor });
        }
      }
    })();
  }
  await drainTargets(4000);
  console.log("initial targets:", JSON.stringify(targets.map(t => t.url?.slice(0, 60))));
  const bg = targets.find(t => /background/.test(t.url ?? "")) ?? targets.find(t => /^moz-extension:/.test(t.url ?? ""));
  if (!bg) {
    console.log("no background target");
    c.close();
    process.exit(1);
  }
  async function evalIn(consoleActor, text) {
    const resp = await c.req(consoleActor, { type: "evaluateJSAsync", text });
    const result = resp.resultID ? await c.wait(consoleActor, 30000) : resp;
    return result.result;
  }
  console.log("openPopup:", JSON.stringify(await evalIn(bg.consoleActor, "(browser.action||browser.browserAction).openPopup()")));
  await drainTargets(3000);
  const popup = targets.find(t => /popup\.html/.test(t.url ?? ""));
  if (!popup) {
    console.log("popup target not found; targets:", JSON.stringify(targets.map(t => t.url?.slice(0, 60))));
    c.close();
    process.exit(1);
  }
  await evalIn(popup.consoleActor, `globalThis.__pm='run';(async()=>{const s=ms=>new Promise(r=>setTimeout(r,ms));const t=[...document.querySelectorAll('button,[role=tab]')].find(b=>/settings/i.test((b.textContent||'')+(b.getAttribute('aria-label')||'')));t&&t.click();await s(400);const tr=document.querySelector('.set-picker-btn');tr&&tr.click();await s(500);const l=document.querySelector('.dropdown-list');if(!l){globalThis.__pm=JSON.stringify({error:'no list',innerHeight:window.innerHeight});return;}const cs=getComputedStyle(l);const r=l.getBoundingClientRect();globalThis.__pm=JSON.stringify({innerHeight:window.innerHeight,docScrollH:document.documentElement.scrollHeight,maxBlockSize:cs.maxBlockSize,overflowY:cs.overflowY,clientHeight:l.clientHeight,scrollHeight:l.scrollHeight,rectTop:Math.round(r.top),rectBottom:Math.round(r.bottom),rectHeight:Math.round(r.height),isScrollable:l.scrollHeight>l.clientHeight,options:l.querySelectorAll('[role=option]').length});})();'kicked'`);
  await new Promise(r => setTimeout(r, 1800));
  console.log("MEASURE:", JSON.stringify(await evalIn(popup.consoleActor, "globalThis.__pm")));
}

c.close();
process.exit(0);
