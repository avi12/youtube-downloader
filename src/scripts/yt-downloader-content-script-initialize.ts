import $ from "jquery";
import Port = chrome.runtime.Port;
import { getStorage } from "./utils";

let gPort: Port;

function attachToBackground() {
  gPort = chrome.runtime.connect({ name: "youtube-page" });
}

async function handleFFmpegReadiness() {
  const $body = $("body");
  const isFFmpegReady = (await getStorage("local", "isFFmepgReady")) ?? false;
  $body.data("ffmpeg-ready", isFFmpegReady as boolean);

  chrome.storage.onChanged.addListener(changes => {
    if (!changes.isFFmpegReady) {
      return;
    }

    $body.data("ffmpeg-ready", changes.isFFmpegReady.newValue);
  });
}

async function init() {
  attachToBackground();
  await handleFFmpegReadiness();
}

init();
