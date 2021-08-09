import { getStorage } from "./utils";
import type { PlayerResponse } from "./types";
import { handleVideo } from "./yt-downloader-content-script-video";
import { handlePlaylist } from "./yt-downloader-content-script-playlist";
import Port = chrome.runtime.Port;

let gPorts: {
  main?: Port;
  processMedia?: Port;
};

declare global {
  interface Window {
    videoDataRaw: PlayerResponse;
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
    processMedia: chrome.runtime.connect({ name: "process-media" })
  };
}

async function waitForFFmpeg() {
  return new Promise(async resolve => {
    const isFFmpegReady = (await getStorage("local", "isFFmpegReady")) ?? false;

    if (isFFmpegReady) {
      resolve(true);
      return;
    }

    const listenToFFmpeg = changes => {
      if (changes?.isFFmpegReady.newValue) {
        resolve(true);
        chrome.storage.onChanged.removeListener(listenToFFmpeg);
      }
    };

    chrome.storage.onChanged.addListener(listenToFFmpeg);
  });
}

async function handleFFmpegReadiness() {
  const $body = document.body;
  const isFFmpegReady = (await getStorage("local", "isFFmpegReady")) ?? false;
  $body.setAttribute("data-ffmpeg-ready", isFFmpegReady.toString());

  chrome.storage.onChanged.addListener(changes => {
    if (!changes.isFFmpegReady) {
      return;
    }

    $body.setAttribute(
      "data-ffmpeg-ready",
      changes.isFFmpegReady.newValue.toString()
    );
  });
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
  new MutationObserver(async () => {
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
  await waitForFFmpeg();
  await handleFFmpegReadiness();

  await init();
}).observe(document.documentElement, gObserverOptions);
