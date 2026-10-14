/**
 * What the dev server adds to its builds (never to `wxt build` or a release) so a hot-swap can keep
 * the YouTube page alive.
 *
 * Run-once guard: every content script runs at most once per world. Firefox re-runs ALL declared
 * content scripts, MAIN-world ones included, in already-open tabs whenever an add-on reloads - and a
 * second copy of a page-world script stacks duplicate listeners on the page. Chrome never re-runs them,
 * and a reloaded extension gets a fresh isolated world there, so the guard never blocks a needed run.
 *
 * Handshake replay: the MAIN-world script sends some messages to the ISOLATED world once per video -
 * panelContentReady is what mounts the watch page's download panel - so a freshly re-injected
 * ISOLATED script would leave the panel empty until the next video. One extra MAIN-world content
 * script records the latest of each such message, and a hot-swap replays it once the fresh script
 * answers. The event names mirror @webext-core/messaging's custom-event transport (dist/page.mjs),
 * which src/lib/messaging/cross-world-messenger.ts builds on.
 */

import { ContentScriptWorld, listContentScripts, readBuiltManifest } from "./dev-output-changes.ts";
import {
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";

const REQUEST_EVENT = "@webext-core/messaging/custom-events";
const RESPONSE_EVENT = "@webext-core/messaging/custom-events/response";
// CrossWorldMessage.PanelContentReady in src/lib/messaging/cross-world-messenger.ts
const REPLAYED_MESSAGE_TYPES = ["panelContentReady"];
const RECORDS_GLOBAL = "__ytdlDevCrossWorldRecords";
const RAN_CONTENT_SCRIPTS_GLOBAL = "__ytdlDevRanContentScripts";
const REPLAY_ATTEMPTS = 20;
const REPLAY_ANSWER_TIMEOUT_MS = 250;
const CROSS_WORLD_RECORDER_FILE = "dev/cross-world-recorder.js";

const RECORDER_SOURCE = `(() => {
  const records = new Map();
  globalThis[${JSON.stringify(RECORDS_GLOBAL)}] = records;
  addEventListener(${JSON.stringify(REQUEST_EVENT)}, e => {
    const type = e.detail?.message?.type;
    if (${JSON.stringify(REPLAYED_MESSAGE_TYPES)}.includes(type)) {
      records.set(type, e.detail);
    }
  });
})();
`;

// The recorder runs in the page itself from document_start, in every top frame the ISOLATED content
// scripts match, so it hears the MAIN-world script's first message
export function addRecorderContentScript(contentScripts: {
  matches?: string[];
  world?: string;
}[]) {
  const isolatedMatches = contentScripts.filter(entry => entry.world !== ContentScriptWorld.Main).flatMap(entry => entry.matches ?? []);
  return [
    ...contentScripts,
    {
      matches: [...new Set(isolatedMatches)],
      js: [CROSS_WORLD_RECORDER_FILE],
      run_at: "document_start" as const,
      world: ContentScriptWorld.Main
    }
  ];
}

function guardRunOnce({ name, source }: {
  name: string;
  source: string;
}) {
  const ranScripts = `globalThis[${JSON.stringify(RAN_CONTENT_SCRIPTS_GLOBAL)}]`;
  return `if (!(${ranScripts} ??= new Set()).has(${JSON.stringify(name)})) {
${ranScripts}.add(${JSON.stringify(name)});
${source}
}
`;
}

// Runs once WXT has written the build: adds the recorder and guards every content script
export function patchBuiltOutput(outputDir: string) {
  const recorderPath = join(outputDir, CROSS_WORLD_RECORDER_FILE);
  mkdirSync(dirname(recorderPath), { recursive: true });
  writeFileSync(recorderPath, RECORDER_SOURCE);

  for (const file of listContentScripts(readBuiltManifest(outputDir)).flatMap(entry => entry.js)) {
    const filePath = join(outputDir, file);
    writeFileSync(filePath, guardRunOnce({
      name: file,
      source: readFileSync(filePath, "utf-8")
    }));
  }
}

// A function source for scripting.executeScript({ world: "MAIN", func }): re-sends each recorded
// message under a fresh id until a listener answers - the fresh ISOLATED script registers its
// handlers only after its first await - and resolves to how many were delivered. The recorded sender
// id is kept, so the MAIN-world messenger ignores its own replay.
export const REPLAY_FUNCTION_SOURCE = `async () => {
  const records = globalThis[${JSON.stringify(RECORDS_GLOBAL)}];
  if (!records) {
    return 0;
  }

  let deliveredCount = 0;
  for (const detail of records.values()) {
    for (let attempt = 0; attempt < ${REPLAY_ATTEMPTS}; attempt++) {
      const id = Math.floor(Math.random() * 1e9);
      const isAnswered = await new Promise(resolve => {
        const timer = setTimeout(() => {
          removeEventListener(${JSON.stringify(RESPONSE_EVENT)}, onResponse);
          resolve(false);
        }, ${REPLAY_ANSWER_TIMEOUT_MS});
        function onResponse(e) {
          if (e.detail?.namespace !== detail.namespace || e.detail?.message?.id !== id) {
            return;
          }

          clearTimeout(timer);
          removeEventListener(${JSON.stringify(RESPONSE_EVENT)}, onResponse);
          resolve(true);
        }

        addEventListener(${JSON.stringify(RESPONSE_EVENT)}, onResponse);
        dispatchEvent(new CustomEvent(${JSON.stringify(REQUEST_EVENT)}, {
          detail: { ...detail, message: { ...detail.message, id, timestamp: Date.now() } }
        }));
      });
      if (isAnswered) {
        deliveredCount++;
        break;
      }
    }
  }
  return deliveredCount;
}`;
