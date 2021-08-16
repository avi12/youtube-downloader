import { createFFmpeg, fetchFile, FFmpeg } from "@ffmpeg/ffmpeg";
import { saveAs } from "file-saver";
import { getMediaId, setStorage } from "./utils";
import type { MediaType, Tabs, Tracker, VideoQueue } from "./types";
import { ref, watch } from "@vue/runtime-core";
import Port = chrome.runtime.Port;

let gCancelControllers: AbortController[] = [];
let gFfmpeg: FFmpeg;
const gVideoQueue = ref<VideoQueue>([]);
const gTracker = {
  tabs: {},
  videoDetails: {}
} as Tracker;

function exitFFmpeg() {
  if (!gFfmpeg?.isLoaded()) {
    return;
  }
  // Wrapping in a try-catch block
  // because ".exit()" will throw an error
  try {
    gFfmpeg.exit();
    // eslint-disable-next-line no-empty
  } catch {}
}

async function initializeFFmpeg() {
  gFfmpeg = createFFmpeg({ log: true });
  await gFfmpeg.load();
}

async function restartFFmpeg() {
  exitFFmpeg();
  await initializeFFmpeg();
  await processCurrentVideoWhenAvailable();
}

export function getMediaType(url: string): MediaType {
  const urlObj = new URL(url);
  if (urlObj.pathname === "/watch") {
    return "video";
  }
  return "playlist";
}

function cancelOngoingDownloads() {
  gCancelControllers.forEach(controller => {
    try {
      controller.abort();
      // eslint-disable-next-line no-empty
    } catch {}
  });

  gCancelControllers = [];
}

async function removeVideosFromQueue(idsToRemove: string[]) {
  const iLastProcessingInProgress = idsToRemove.indexOf(gVideoQueue.value[0]);

  if (iLastProcessingInProgress > -1) {
    gVideoQueue.value.shift();
    idsToRemove.splice(iLastProcessingInProgress, 1);
    await restartFFmpeg();
  }

  idsToRemove.forEach(idToRemove => {
    const iVideo = gVideoQueue.value.indexOf(idToRemove);
    if (iVideo > -1) {
      gVideoQueue.value.splice(iVideo, 1);
    }
  });

  cancelOngoingDownloads();
}

async function handleMainConnection(port: Port) {
  const { url, id: idTab } = port.sender.tab;

  gTracker.tabs[idTab] = {
    type: getMediaType(url),
    idMedia: getMediaId(url)
  };

  port.onMessage.addListener(async message => {
    if (message.action === "navigated") {
      const { id: idTab } = port.sender.tab;
      const tabTracked = gTracker.tabs[idTab];

      gTracker.tabs[idTab] = {
        type: getMediaType(message.newUrl),
        idMedia: getMediaId(message.newUrl)
      };

      cancelOngoingDownloads();
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
    const tabTracked = gTracker.tabs[idTab];
    delete gTracker.tabs[idTab];

    cancelOngoingDownloads();
    if (tabTracked.type === "playlist") {
      const { idVideos } = tabTracked;
      if (idVideos) {
        await removeVideosFromQueue(idVideos);
      }
      return;
    }

    await removeVideosFromQueue([tabTracked.idMedia]);
  });
}

function deleteFiles(files: string[]) {
  files.forEach(file => gFfmpeg.FS("unlink", file));
}

function mimeToExt(response: Response): string {
  return response.headers.get("Content-Type").split("/").pop();
}

async function processMedia({
  tabId,
  urls,
  filenameOutput,
  videoId
}: {
  tabId: number;
  urls: {
    video: string;
    audio: string;
  };
  filenameOutput: string;
  videoId: string;
}) {
  gTracker.videoDetails[videoId] = {
    urls: {
      video: urls.video,
      audio: urls.audio
    },
    filenameOutput
  };

  const videoAbortController = new AbortController();
  const audioAbortController = new AbortController();

  gCancelControllers.push(videoAbortController, audioAbortController);

  const [responseVideo, responseAudio] = await Promise.all([
    fetch(urls.video, { signal: videoAbortController.signal }),
    fetch(urls.audio, { signal: audioAbortController.signal })
  ]);

  const [filenameVideo, filenameAudio, filenameOutputTemp] = [
    `${videoId}-video.${mimeToExt(responseVideo)}`,
    `${videoId}-audio.${mimeToExt(responseAudio)}`,
    `${videoId}-output.mp4`
  ];

  gFfmpeg.setProgress(({ ratio }) => {
    chrome.tabs.sendMessage(tabId, {
      updateProgress: {
        videoId,
        progress: ratio
      }
    });
  });

  gFfmpeg.FS(
    "writeFile",
    filenameVideo,
    await fetchFile(await responseVideo.blob())
  );

  gFfmpeg.FS(
    "writeFile",
    filenameAudio,
    await fetchFile(await responseAudio.blob())
  );

  await gFfmpeg.run(
    "-i",
    filenameVideo,
    "-i",
    filenameAudio,
    "-c:v",
    "copy",
    filenameOutputTemp
  );

  const dataFile = gFfmpeg.FS("readFile", filenameOutputTemp);

  deleteFiles([filenameVideo, filenameAudio, filenameOutputTemp]);
  saveAs(new Blob([dataFile.buffer]), filenameOutput);

  const iVideo = gVideoQueue.value.indexOf(videoId);
  gVideoQueue.value.splice(iVideo, 1);
}

function handleMediaProcessing(port: Port) {
  port.onMessage.addListener(async processInfo => {
    if (!gVideoQueue.value.includes(processInfo.videoId)) {
      gVideoQueue.value.push(processInfo.videoId);
    }
    gTracker.videoDetails[processInfo.videoId] = {
      urls: { ...processInfo.urls },
      filenameOutput: processInfo.filenameOutput
    };

    // if (processInfo.type === "video+audio") {
    // } else if (processInfo.type === "video") {
    //   const videoDetail = gTracker.videoDetails[processInfo.videoId];
    //   saveAs(videoDetail.urls.video, videoDetail.filenameOutput);
    //   gVideoQueue.value.splice(0, 1);
    // } else if (processInfo.type === "audio") {
    //   // TODO: Download only audio as MP3 after being processed by Browser ID3 Writer
    // }
  });
}

function removeVideoIdsFromTabs(videoIdsToCancel: string[]) {
  for (const videoId of videoIdsToCancel) {
    for (const tabId in gTracker.tabs) {
      if (
        gTracker.tabs[tabId].type === "playlist" &&
        gTracker.tabs[tabId].idVideos.includes(videoId)
      ) {
        const iVideo = gTracker.tabs[tabId].idVideos.indexOf(videoId);
        gTracker.tabs[tabId].idVideos.splice(iVideo, 1);
      }
    }
  }
}

function listenToTabs() {
  chrome.runtime.onConnect.addListener(async port => {
    if (port.name === "main-connection") {
      await handleMainConnection(port);
    } else if (port.name === "process-media") {
      handleMediaProcessing(port);
    }
  });

  chrome.runtime.onMessage.addListener(
    async (message: {
      action: "cancel-download";
      videoIdsToCancel: string[];
    }) => {
      if (message.action === "cancel-download") {
        removeVideoIdsFromTabs(message.videoIdsToCancel);

        cancelOngoingDownloads();
        await removeVideosFromQueue(message.videoIdsToCancel);
      }
    }
  );
}

function getTabId({ tabs, videoId }: { tabs: Tabs; videoId: string }): number {
  for (const tabId in tabs) {
    if (tabs[tabId].idMedia === videoId) {
      return Number(tabId);
    }
  }
}

async function processCurrentVideoWhenAvailable() {
  const delay = () => new Promise(resolve => setTimeout(resolve, 500));
  while (1) {
    const videoId = gVideoQueue.value[0];
    if (!videoId) {
      await delay();
      continue;
    }

    const tabId = getTabId({
      tabs: gTracker.tabs,
      videoId
    });
    await processMedia({
      tabId: tabId,
      videoId,
      ...gTracker.videoDetails[videoId]
    });
  }
}

function addWatchers() {
  watch(gVideoQueue.value, async videoQueue => {
    await setStorage("local", "videoQueue", [...videoQueue]);
  });
}

chrome.runtime.onInstalled.addListener(() =>
  setStorage("local", "videoQueue", [])
);

async function init() {
  addWatchers();
  listenToTabs();
  await initializeFFmpeg();
  await processCurrentVideoWhenAvailable();
}

init();
