import { getMediaId, setStorage } from "./utils";
import { createFFmpeg, FFmpeg } from "@ffmpeg/ffmpeg";
import { getRemote, getMediaMetadata } from "./yt-downloader-functions";
import Port = chrome.runtime.Port;

type MediaType = "video" | "playlist" | "other";

let gFfmpeg: FFmpeg;
const gTracker = {
  videoQueue: [] as string[],
  tabs: new Map() as Map<
    number,
    {
      // The type of the media.
      type: MediaType;
      // The ID of the video/playlist.
      idMedia: string;
      // If the media is a playlist, this is the list of videos to be downloaded.
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
  const { url, id: idTab } = port.sender.tab;
  gTracker.tabs.set(idTab, {
    type: getMediaType(url),
    idMedia: getMediaId(url)
  });

  const removeVideosFromQueue = async (idsToRemove: string[]) => {
    const iLastDownloadInProgress = idsToRemove.indexOf(
      gTracker.videoQueue[gTracker.videoQueue.length - 1]
    );

    if (iLastDownloadInProgress > -1) {
      gTracker.videoQueue.pop();
      idsToRemove.splice(iLastDownloadInProgress, 1);

      // TODO: Cancel media download, if applicable
      exitFFmpeg();
      initializeFFmpeg();
    }

    for (const idToRemove of idsToRemove) {
      const iVideo = gTracker.videoQueue.indexOf(idToRemove);
      if (iVideo > -1) {
        gTracker.videoQueue.splice(iVideo, 1);
      }
    }

    // TODO: Resume downloading the latest video on queue
    // TODO: Update the storage of the video queue (affects the popup page)
  };

  port.onMessage.addListener(async message => {
    if (message.action === "navigated") {
      const { id: idTab, url } = port.sender.tab;
      const tabTracked = gTracker.tabs.get(idTab);

      gTracker.tabs.set(idTab, {
        type: getMediaType(url),
        idMedia: getMediaId(url)
      });

      if (tabTracked.type === "playlist") {
        await removeVideosFromQueue(tabTracked.idVideos);
        return;
      }

      await removeVideosFromQueue([tabTracked.idMedia]);
    }
  });

  port.onDisconnect.addListener(async () => {
    const { id: idTab } = port.sender.tab;
    const tabTracked = gTracker.tabs.get(idTab);
    gTracker.tabs.delete(idTab);

    if (tabTracked.type === "other") {
      return;
    }

    if (tabTracked.type === "playlist") {
      await removeVideosFromQueue(tabTracked.idVideos);
      return;
    }

    await removeVideosFromQueue([tabTracked.idMedia]);
  });
}

function handleMetadata(port: Port) {
  port.onMessage.addListener(async () => {
    const { url } = port.sender.tab;
    port.postMessage(
      await getMediaMetadata({
        id: getMediaId(url),
        mediaType: getMediaType(url) as "video" | "playlist"
      })
    );
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
      gTracker.videoQueue.push(getMediaId(port.sender.tab.url));
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
