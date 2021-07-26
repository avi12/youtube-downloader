import { setStorage } from "./utils";
import { createFFmpeg } from "@ffmpeg/ffmpeg";

let gFfmpeg;
const gVideos = [];

async function initializeFFmpeg() {
  await setStorage("local", "isFFmpegReady", false);

  gFfmpeg = createFFmpeg({ log: true });
  await gFfmpeg.load();

  await setStorage("local", "isFFmpegReady", true);
}

function listenToTabs() {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === "youtube-page") {
      port.onMessage.addListener(message => {
        if (message) {
        }
      });
    }
    port.onDisconnect.addListener(() => {});
  });
}

async function init() {
  await initializeFFmpeg();
  listenToTabs();
}

init();
