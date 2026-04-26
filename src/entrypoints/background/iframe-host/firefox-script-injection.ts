const HOSTED_IFRAME_URL_FILTERS: Browser.events.UrlFilter[] = [
  { urlContains: "ytdlScrubMode=1" },
  { urlContains: "ytdlTrustFactoryMode=1" }
];

const MAIN_WORLD_DOCUMENT_START_FILES = [
  "/content-scripts/automation-spoof.js",
  "/content-scripts/sabr-fetch-interceptor.js",
  "/content-scripts/sourcebuffer-capture.js",
  "/content-scripts/visibility-spoof.js"
] as const satisfies ScriptPublicPath[];

const MAIN_WORLD_DEFAULT_FILES = [
  "/content-scripts/youtube-main.js"
] as const satisfies ScriptPublicPath[];

const ISOLATED_WORLD_FILES = [
  "/content-scripts/youtube.js"
] as const satisfies ScriptPublicPath[];

async function injectFiles({ tabId, frameId, files, world }: {
  tabId: number;
  frameId: number;
  files: readonly ScriptPublicPath[];
  world: `${Browser.scripting.ExecutionWorld}`;
}) {
  await browser.scripting.executeScript({
    target: {
      tabId,
      frameIds: [frameId]
    },
    files: [...files],
    world,
    injectImmediately: true
  });
}

async function injectAllScripts({ tabId, frameId }: {
  tabId: number;
  frameId: number;
}) {
  await injectFiles({
    tabId,
    frameId,
    files: MAIN_WORLD_DOCUMENT_START_FILES,
    world: "MAIN"
  });
  await injectFiles({
    tabId,
    frameId,
    files: ISOLATED_WORLD_FILES,
    world: "ISOLATED"
  });
  await injectFiles({
    tabId,
    frameId,
    files: MAIN_WORLD_DEFAULT_FILES,
    world: "MAIN"
  });
}

export function registerHostedIframeScriptInjection() {
  if (!import.meta.env.FIREFOX) {
    return;
  }

  browser.webNavigation.onCommitted.addListener(
    ({ tabId, frameId, url }) => {
      if (frameId === 0) {
        return;
      }

      void injectAllScripts({
        tabId,
        frameId
      }).catch(error => {
        console.warn(`[ytdl:script-injection] failed url=${url} frameId=${frameId}`, error);
      });
    },
    { url: HOSTED_IFRAME_URL_FILTERS }
  );
}
