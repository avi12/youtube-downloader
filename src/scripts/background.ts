import { getVideoId, setStorage } from "./utils";
import { createFFmpeg, FFmpeg } from "@ffmpeg/ffmpeg";

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

async function initializeFFmpeg() {
  await setStorage("local", "isFFmpegReady", false);

  gFfmpeg = createFFmpeg({ log: true });
  await gFfmpeg.load();

  await setStorage("local", "isFFmpegReady", true);
}

function getMediaType(url: string): MediaType {
  const urlObj = new URL(url);
  if (urlObj.pathname === "/watch") {
    return "video";
  }
  if (urlObj.pathname === "/playlist") {
    return "playlist";
  }

  return "other";
}

function handleTab(port: chrome.runtime.Port) {
  gTracker.tabs.set(port.sender.tab.id, {
    type: getMediaType(port.sender.url),
    id: getVideoId(port.sender.tab.url)
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
    gFfmpeg.exit();
    await initializeFFmpeg();
  });
}

function listenToTabs() {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === "youtube-page") {
      handleTab(port);
    }
  });
}

async function init() {
  listenToTabs();
  await initializeFFmpeg();
}

init();
