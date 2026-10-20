import { z } from "zod";
import { RESULT_EVENT_PREFIX, TASK_EVENT } from "@/lib/page-events";
import type { TabTask, TaskRequest } from "@/lib/page-events";
import { runInsideYouTubePage } from "@/lib/page-task";

const MANIFEST_V2 = 2;
const BRIDGE_CHANNEL = "ffmpeg-lite-page-task";
const READY_ATTRIBUTE = "data-ffmpeg-lite-ready";
const PAGE_TASK_SCRIPT = "/page-task.js";
const PAGE_TASK_TIMEOUT_MS = 120_000;

const bridgeMessageSchema = z.object({ channel: z.literal(BRIDGE_CHANNEL), id: z.string(), result: z.unknown() });

export async function runPageTaskInMainWorld({ tabId, task }: TabTask & { tabId: number }) {
  if (browser.runtime.getManifest().manifest_version !== MANIFEST_V2) {
    const [injection] = await browser.scripting.executeScript({ target: { tabId }, world: "MAIN", func: runInsideYouTubePage, args: [task] });
    return injection?.result;
  }

  const id = crypto.randomUUID();
  const answer = waitForBridgeAnswer(id);
  await browser.tabs.executeScript(tabId, { code: buildIsolatedSnippet({ id, task }) });
  return answer;
}

function waitForBridgeAnswer(id: string) {
  return new Promise<unknown>((resolve, reject) => {
    const timeout = AbortSignal.timeout(PAGE_TASK_TIMEOUT_MS);
    function listener(message: unknown) {
      const parsed = bridgeMessageSchema.safeParse(message);
      if (!parsed.success || parsed.data.id !== id) {
        return;
      }

      browser.runtime.onMessage.removeListener(listener);
      resolve(parsed.data.result);
    }

    timeout.addEventListener("abort", () => {
      browser.runtime.onMessage.removeListener(listener);
      reject(new Error("The YouTube page didn't answer"));
    }, { once: true });
    browser.runtime.onMessage.addListener(listener);
  });
}

function buildIsolatedSnippet({ id, task }: TaskRequest) {
  const scriptUrl = browser.runtime.getURL(PAGE_TASK_SCRIPT);
  return `(() => {
    const send = () => {
      document.addEventListener(${JSON.stringify(RESULT_EVENT_PREFIX + id)}, e => chrome.runtime.sendMessage({ channel: ${JSON.stringify(BRIDGE_CHANNEL)}, id: ${JSON.stringify(id)}, result: JSON.parse(e.detail) }), { once: true });
      document.dispatchEvent(new CustomEvent(${JSON.stringify(TASK_EVENT)}, { detail: ${JSON.stringify(JSON.stringify({ id, task }))} }));
    };
    if (document.documentElement.hasAttribute(${JSON.stringify(READY_ATTRIBUTE)})) {
      send();
      return;
    }
    const script = document.createElement("script");
    script.src = ${JSON.stringify(scriptUrl)};
    script.onload = () => {
      document.documentElement.setAttribute(${JSON.stringify(READY_ATTRIBUTE)}, "");
      script.remove();
      send();
    };
    document.documentElement.append(script);
  })()`;
}
