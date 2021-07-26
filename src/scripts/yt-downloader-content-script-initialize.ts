import { getStorage } from "./utils";
import Port = chrome.runtime.Port;

let gPort: Port;

async function waitForFFmpeg() {
  return new Promise(async resolve => {
    const isFFmpegReady = (await getStorage("local", "isFFmpegReady")) ?? false;
    if (isFFmpegReady) {
      resolve(true);
      return;
    }

    chrome.storage.onChanged.addListener(changes => {
      if (changes.isFFmpegReady?.newValue) {
        resolve(true);
      }
    });
  });
}

function attachToBackground() {
  gPort = chrome.runtime.connect({ name: "youtube-page" });
  gPort.postMessage("");
}

async function init() {
  await waitForFFmpeg();
  attachToBackground();
}

init();
