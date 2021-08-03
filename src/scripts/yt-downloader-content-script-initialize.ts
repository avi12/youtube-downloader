import $ from "jquery";
import { getStorage } from "./utils";
import type { PlayerResponse } from "./types";
import Port = chrome.runtime.Port;

let gScriptToInject: string;

declare global {
  interface Window {
    videoDataRaw: PlayerResponse;
  }
}

const gPorts: {
  [portName: string]: Port;
} = {};

function attachToBackground() {
  gPorts.main = chrome.runtime.connect({ name: "main-connection" });
  gPorts.fetchScriptToInject = chrome.runtime.connect({
    name: "script-to-inject"
  });
  gPorts.metadata = chrome.runtime.connect({ name: "get-metadata" });
  gPorts.downloadMedia = chrome.runtime.connect({ name: "download-media" });
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
  const $body = $("body");
  const isFFmpegReady = (await getStorage("local", "isFFmpegReady")) ?? false;
  $body.data("ffmpeg-ready", isFFmpegReady as boolean);

  chrome.storage.onChanged.addListener(changes => {
    if (!changes.isFFmpegReady) {
      return;
    }

    $body.data("ffmpeg-ready", changes.isFFmpegReady.newValue);
  });
}

async function getVideoMetadata(): Promise<PlayerResponse> {
  return new Promise(resolve => {
    gPorts.metadata.postMessage(true);
    gPorts.metadata.onMessage.addListener(resolve);
  });
}

function getCurrentQuality() {
  return document.body.dataset.ytDownloaderCurrentQuality;
}

function injectScript(code = gScriptToInject) {
  if (!gScriptToInject) {
    gScriptToInject = code;
  }
  $("head").append(`<script>${code}</script>`);
}

async function addQualityListener() {
  gPorts.fetchScriptToInject.postMessage(true);
  gPorts.fetchScriptToInject.onMessage.addListener(injectScript);
}

function addNavigationListener() {
  new MutationObserver(() => {
    gPorts.main.postMessage({
      action: "navigated"
    });
  }).observe($("title")[0], { childList: true, subtree: true });
}

$(async () => {
  addNavigationListener();

  const isVideoOrPlaylist = Boolean(location.pathname.match(/watch|playlist/));
  if (!isVideoOrPlaylist) {
    return;
  }

  attachToBackground();
  await waitForFFmpeg();
  await handleFFmpegReadiness();
  if (location.pathname === "/watch") {
    await addQualityListener();
  }

  window.videoDataRaw = await getVideoMetadata();
  console.log(window.videoDataRaw);

  const getIsLive = (videoDataRaw: PlayerResponse) =>
    videoDataRaw.microformat?.playerMicroformatRenderer.liveBroadcastDetails
      ?.isLiveNow;

  if (getIsLive(window.videoDataRaw)) {
    // TODO: Add "Undownloadable"
    return;
  }

  // TODO: Remove line; instead, add to the queue by clicking on the download button
  gPorts.downloadMedia.postMessage({
    type: "video+audio",
    quality: getCurrentQuality()
  });
});
