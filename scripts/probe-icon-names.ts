import { fetchTargets } from "./cdp-utils.js";
import WebSocket from "ws";

const CDP_PORT = 9229;

function evalInTarget(wsUrl: string, expression: string, awaitPromise = false): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timeout = setTimeout(() => { socket.close(); reject(new Error("timeout")); }, 30_000);

    socket.on("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      socket.send(JSON.stringify({
        id: 2,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise }
      }));
    });

    socket.on("message", rawData => {
      const msg = JSON.parse(String(rawData));
      if (msg.id === 2) {
        clearTimeout(timeout);
        socket.close();
        if (msg.result?.exceptionDetails) {
          reject(new Error(msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text));
        } else {
          resolve(msg.result?.result?.value);
        }
      }
    });

    socket.on("error", err => { clearTimeout(timeout); reject(err); });
  });
}

const targets = await fetchTargets(CDP_PORT);
const ytPage = targets.find(t => t.url?.includes("youtube.com/watch"));
if (!ytPage?.webSocketDebuggerUrl) {
  console.log("No YouTube watch page found");
  process.exit(1);
}
console.log("Found page:", ytPage.url);

const result = await evalInTarget(ytPage.webSocketDebuggerUrl, `
(async () => {
  const bvm = document.querySelector('.ytdl-download-button');
  if (!bvm) return { error: 'no button', tag: 'n/a' };

  // Find the outer yt-button-view-model (the one with data setter)
  // The class was transferred to inner button-view-model by YouTube
  const innerBvm = document.querySelector('.ytdl-download-button');
  const outerYtBvm = innerBvm?.closest('yt-button-view-model') ?? innerBvm?.parentElement?.closest('yt-button-view-model');

  if (!outerYtBvm) return { error: 'no outer yt-button-view-model', innerTag: innerBvm?.tagName, parentTag: innerBvm?.parentElement?.tagName };

  // Verify it has data setter
  let p = Object.getPrototypeOf(outerYtBvm);
  while (p) {
    const d = Object.getOwnPropertyDescriptor(p, 'data');
    if (d?.set) {
      const origSetter = d.set.bind(outerYtBvm);
      const origGetter = d.get?.bind(outerYtBvm);

      // Freeze data so Svelte can't override
      let frozen = origGetter?.();
      Object.defineProperty(outerYtBvm, 'data', {
        get: () => frozen,
        set: v => { frozen = v; },
        configurable: true
      });

      const makeData = name => ({
        iconName: name, title: 'Test', accessibilityText: 'Test',
        style: 'BUTTON_STYLE_MONO', type: 'BUTTON_TYPE_TONAL',
        buttonSize: 'BUTTON_SIZE_DEFAULT', state: 'BUTTON_STATE_ACTIVE',
        isFullWidth: false, isDisabled: false,
      });

      // First confirm DOWNLOAD icon works as baseline
      origSetter(makeData('DOWNLOAD'));
      await new Promise(r => setTimeout(r, 200));
      const baselineHTML = outerYtBvm.querySelector('button')?.innerHTML?.slice(0, 200);
      const baselineTitle = outerYtBvm.querySelector('button')?.querySelector('div')?.textContent;

      const results = { _baseline_DOWNLOAD: baselineHTML, _baseline_title: baselineTitle };
      const candidates = ['AUTORENEW','REFRESH','REPLAY','LOOP','UNDO','ROTATE_RIGHT','SYNC','CACHED','RESTORE','REPEAT','RETRY','RELOAD','RENEW'];
      for (const name of candidates) {
        origSetter(makeData(name));
        await new Promise(r => setTimeout(r, 100));
        // Get the SVG path data to see what icon renders
        const svgPath = outerYtBvm.querySelector('.ytSpecButtonShapeNextIcon svg path')?.getAttribute('d')?.slice(0, 40) || 'no-path';
        results[name] = svgPath;
      }

      // Restore
      delete outerYtBvm.data;
      origSetter({ iconName: '', title: 'Retry', accessibilityText: 'Retry download', style: 'BUTTON_STYLE_MONO', type: 'BUTTON_TYPE_TONAL', buttonSize: 'BUTTON_SIZE_DEFAULT', state: 'BUTTON_STATE_ACTIVE', isFullWidth: false, isDisabled: false });

      return results;
    }
    p = Object.getPrototypeOf(p);
  }
  return { error: 'data setter not found on outer bvm' };

  const origSetter = desc.set.bind(bvm);
  const origGetter = desc.get ? desc.get.bind(bvm) : null;

  // Freeze data property on the instance so Svelte cannot override
  let frozenValue = origGetter?.();
  Object.defineProperty(bvm, 'data', {
    get: () => frozenValue,
    set: v => { frozenValue = v; },
    configurable: true
  });

  const makeData = name => ({
    iconName: name,
    title: 'Test',
    accessibilityText: 'Test',
    style: 'BUTTON_STYLE_MONO',
    type: 'BUTTON_TYPE_TONAL',
    buttonSize: 'BUTTON_SIZE_DEFAULT',
    state: 'BUTTON_STATE_ACTIVE',
    isFullWidth: false,
    isDisabled: false,
  });

  const candidates = [
    'AUTORENEW', 'REFRESH', 'REPLAY', 'LOOP', 'UNDO', 'REDO',
    'ROTATE_RIGHT', 'SYNC', 'UPDATE', 'CACHED', 'RESTORE',
    'REPEAT', 'RETRY', 'RELOAD', 'RENEW'
  ];
  const results = {};

  for (const name of candidates) {
    origSetter(makeData(name));
    await new Promise(r => setTimeout(r, 100));
    results[name] = bvm.innerHTML.includes('yt-icon') || bvm.innerHTML.includes('yt-icon-shape');
  }

  // Restore
  delete bvm.data;
  origSetter(makeData(''));

  return results;
})()
`, true);

console.log("\\n=== Icon name results ===");
console.log(JSON.stringify(result, null, 2));
if (result && typeof result === 'object') {
  const working = Object.entries(result).filter(([, v]) => v).map(([k]) => k);
  console.log("Working icon names:", working.length ? working : "none found");
}
