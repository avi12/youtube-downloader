import { createFFmpeg, FFmpeg } from "@ffmpeg/ffmpeg";
import { getMediaId, setStorage } from "./utils";
import Port = chrome.runtime.Port;

type MediaType = "video" | "playlist";
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
      // If the media is a playlist, this is the list of videos to be processed.
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
  return "playlist";
}

function handleMainConnection(port: Port) {
  const { url, id: idTab } = port.sender.tab;
  gTracker.tabs.set(idTab, {
    type: getMediaType(url),
    idMedia: getMediaId(url)
  });

  const removeVideosFromQueue = async (idsToRemove: string[]) => {
    const iLastProcessingInProgress = idsToRemove.indexOf(
      gTracker.videoQueue[gTracker.videoQueue.length - 1]
    );

    if (iLastProcessingInProgress > -1) {
      gTracker.videoQueue.pop();
      idsToRemove.splice(iLastProcessingInProgress, 1);

      // TODO: Cancel media processing
      exitFFmpeg();
      initializeFFmpeg();
    }

    idsToRemove.forEach(idToRemove => {
      const iVideo = gTracker.videoQueue.indexOf(idToRemove);
      if (iVideo > -1) {
        gTracker.videoQueue.splice(iVideo, 1);
      }
    });

    // TODO: Resume processing the latest video on queue
    // TODO: Update the storage of the video queue (affects the popup page)
  };

  port.onMessage.addListener(async message => {
    if (message.action === "navigated") {
      const { id: idTab } = port.sender.tab;
      const tabTracked = gTracker.tabs.get(idTab);

      gTracker.tabs.set(idTab, {
        type: getMediaType(message.newUrl),
        idMedia: getMediaId(message.newUrl)
      });

      if (tabTracked.type === "playlist") {
        const { idVideos } = tabTracked;
        if (idVideos) {
          await removeVideosFromQueue(idVideos);
        }
        return;
      }

      await removeVideosFromQueue([tabTracked.idMedia]);
    }
  });

  port.onDisconnect.addListener(async () => {
    const { id: idTab } = port.sender.tab;
    const tabTracked = gTracker.tabs.get(idTab);
    gTracker.tabs.delete(idTab);

    if (tabTracked.type === "playlist") {
      await removeVideosFromQueue(tabTracked.idVideos);
      return;
    }

    await removeVideosFromQueue([tabTracked.idMedia]);
  });
}

async function processMedia(data: {
  data: { dataVideoRaw: Blob; dataAudioRaw: Blob };
}) {
  // TODO: Process video and/or audio with FFmpeg
}

function handleMediaProcessing(port: Port) {
  port.onMessage.addListener(async processInfo => {
    if (processInfo.type === "video+audio") {
      gTracker.videoQueue.push(getMediaId(port.sender.tab.url));
      await processMedia(processInfo.data);
    }
  });
}

function listenToTabs() {
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === "main-connection") {
      handleMainConnection(port);
    } else if (port.name === "process-media") {
      handleMediaProcessing(port);
    }
  });
}

async function init() {
  listenToTabs();
  await initializeFFmpeg();
}

init();
