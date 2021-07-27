import $ from "jquery";
import Port = chrome.runtime.Port;
import { getStorage } from "./utils";
import type { VideoData } from "./types";

declare global {
  interface Window {
    videoDataRaw: VideoData;
  }
}

let gPort: Port;

function attachToBackground() {
  gPort = chrome.runtime.connect({ name: "youtube-page" });
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

async function getVideoMetadata(): Promise<VideoData> {
  return new Promise(resolve => {
    gPort.postMessage("get-metadata");
    gPort.onMessage.addListener(resolve);
  });
}

async function init() {
  attachToBackground();
  await waitForFFmpeg();
  await handleFFmpegReadiness();

  window.videoDataRaw = await getVideoMetadata();
}
init();
