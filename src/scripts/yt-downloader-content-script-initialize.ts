import type { PlayerResponse } from "./types";
import { handleVideo } from "./yt-downloader-content-script-video";
import { handlePlaylist } from "./yt-downloader-content-script-playlist";
import Port = chrome.runtime.Port;

export let gPorts: {
  main?: Port;
  processMedia?: Port;
  cancelMediaProcess?: Port;
};

declare global {
  interface Window {
    videoData: PlayerResponse;
  }
}

let gObserverPlaylist: MutationObserver;
const gObserverOptions: MutationObserverInit = {
  subtree: true,
  childList: true
};

export let gCancelControllers: AbortController[] = [];

function attachToBackground() {
  gPorts = {
    main: chrome.runtime.connect({ name: "main-connection" }),
    processMedia: chrome.runtime.connect({ name: "process-media" }),
    cancelMediaProcess: chrome.runtime.connect({ name: "cancel-media-process" })
  };
}

function cancelDownloads() {
  if (gCancelControllers.length === 0) {
    return;
  }
  gCancelControllers.forEach(controller => {
    try {
      controller.abort();
      // eslint-disable-next-line no-empty
    } catch {}
  });

  gCancelControllers = [];
}

function resetObservers() {
  gObserverPlaylist = null;
}

function addNavigationListener() {
  let titleLast = document.title;
  new MutationObserver(async mutations => {
    const title = mutations[0].addedNodes[0].textContent;
    if (title === titleLast) {
      return;
    }
    titleLast = title;

    gPorts.main.postMessage({
      action: "navigated",
      newUrl: location.href
    });

    cancelDownloads();
    resetObservers();
    await init();
  }).observe(document.querySelector("title"), { childList: true });
}

async function init() {
  const isValidPage = Boolean(location.pathname.match(/watch|playlist/));
  if (!isValidPage) {
    return;
  }

  const isVideo = Boolean(location.pathname === "/watch");
  if (isVideo) {
    await handleVideo();
    return;
  }

  await handlePlaylist();
  if (!gObserverPlaylist) {
    gObserverPlaylist = new MutationObserver(handlePlaylist);
  }
  gObserverPlaylist.observe(
    document.querySelector("#contents"),
    gObserverOptions
  );
}

new MutationObserver(async (_, observer) => {
  const isReadyForProcessing = Boolean(document.querySelector("title"));
  if (!isReadyForProcessing) {
    return;
  }

  observer.disconnect();

  attachToBackground();
  addNavigationListener();

  await init();
}).observe(document.documentElement, gObserverOptions);
