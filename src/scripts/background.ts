import { getVideoId, setStorage } from "./utils";
import { createFFmpeg, FFmpeg } from "@ffmpeg/ffmpeg";
import { getRemote, getVideoMetadata } from "./yt-downloader-functions";
import Port = chrome.runtime.Port;

type MediaType = "video" | "playlist" | "other";

let gFfmpeg: FFmpeg;
const gTracker = {
  videoQueue: [] as string[],
  tabs: new Map() as Map<
    number,
    {
      type: MediaType;
      id: string;
      idVideos?: string[];
    }
  >
};

function exitFFmpeg() {
  // Wrapping in a try-catch block
  // because ".exit()" will throw an error as well
  try {
    gFfmpeg.exit();
    // eslint-disable-next-line no-empty
  } catch {}
}
async function initializeFFmpeg() {
  await setStorage("local", "isFFmpegReady", false);

  console.clear();
  gFfmpeg = createFFmpeg({ log: true });
  await gFfmpeg.load();

  await setStorage("local", "isFFmpegReady", true);
}

export function getMediaType(url: string): MediaType {
  const urlObj = new URL(url);
  if (urlObj.pathname === "/watch") {
    return "video";
  }
  if (urlObj.pathname === "/playlist") {
    return "playlist";
  }

  return "other";
}

function handleMainConnection(port: Port) {
  const { url, id } = port.sender.tab;
  gTracker.tabs.set(id, {
    type: getMediaType(url),
    id: getVideoId(url)
  });

  port.onDisconnect.addListener(async () => {
    const { id: idTab } = port.sender.tab;
    const { id: idVideo } = gTracker.tabs.get(idTab);
    gTracker.tabs.delete(idTab);

    const i = gTracker.videoQueue.indexOf(idVideo);
    if (i === -1) {
      return;
    }
    const isLastVideo = i === gTracker.videoQueue.length - 1;
    gTracker.videoQueue.splice(i, 1);

    if (!isLastVideo) {
      return;
    }
    exitFFmpeg();
    await initializeFFmpeg();
  });
}

function handleMetadata(port: Port) {
  port.onMessage.addListener(async () => {
    const { url } = port.sender.tab;
    port.postMessage(await getVideoMetadata(getVideoId(url)));
  });
}

function fetchScriptToInject(port: Port) {
  port.onMessage.addListener(async () => {
    port.postMessage(
      await getRemote(chrome.runtime.getURL("content-script-to-inject.js"))
    );
  });
}

function handleDMediaDownloads(port: Port) {
  port.onMessage.addListener(async downloadInfo => {
    if (downloadInfo.type === "video+audio") {
      gTracker.videoQueue.push(getVideoId(port.sender.tab.url));
    }
  });
}

function listenToTabs() {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === "main-connection") {
      handleMainConnection(port);
    } else if (port.name === "get-metadata") {
      handleMetadata(port);
    } else if (port.name === "script-to-inject") {
      fetchScriptToInject(port);
    } else if (port.name === "download-media") {
      handleDMediaDownloads(port);
    }
  });
}

async function init() {
  listenToTabs();
  await initializeFFmpeg();
}

init();
