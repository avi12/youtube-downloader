import { createFFmpeg, fetchFile, FFmpeg } from "@ffmpeg/ffmpeg";
import { saveAs } from "file-saver";
import { getVideoId, setStorage } from "./utils";
import type { Tab, TabHolder, Tracker, VideoQueue } from "./types";
import { ref, watch } from "@vue/runtime-core";
import Port = chrome.runtime.Port;

let gCancelControllers: AbortController[] = [];
let gFfmpeg: FFmpeg;
const gVideoQueue = ref<VideoQueue>([]);
const gTracker: Tracker = {
  tabs: {},
  videoDetails: {},
  videoIds: {}
};

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

function getIsFoundVideoIdInAnotherTab({
  tabs,
  tabTracked
}: {
  tabs: TabHolder;
  tabTracked: Tab;
}): boolean {
  for (const tabId in tabs) {
    const isFound = tabs[tabId].idVideosAvailable.some(idVideo =>
      tabTracked.idVideosAvailable.includes(idVideo)
    );
    if (isFound) {
      return true;
    }
  }
  return false;
}

async function handleMainConnection(port: Port) {
  const { url, id: idTab } = port.sender.tab;

  const videoId = getVideoId(url);
  gTracker.tabs[idTab] = {
    idVideosAvailable: [videoId]
  };

  const isVideoPage = Boolean(videoId);
  if (isVideoPage) {
    if (!gTracker.videoIds[videoId]) {
      gTracker.videoIds[videoId] = [idTab];
    } else {
      gTracker.videoIds[videoId].push(idTab);
    }
  }

  port.onMessage.addListener(async message => {
    if (message.action === "insert-playlist-videos") {
      gTracker.tabs[idTab].idVideosAvailable = message.videoIds;
      message.videoIds.forEach(videoId => {
        if (!gTracker.videoIds[videoId]) {
          gTracker.videoIds[videoId] = [];
        }
        gTracker.videoIds[videoId].push(idTab);
      });
      return;
    }

    if (message.action === "navigated") {
      const { id: idTab, url: urlOld } = port.sender.tab;
      const tabTracked = gTracker.tabs[idTab];

      const [videoIdOld, videoIdNew] = [
        getVideoId(urlOld),
        getVideoId(message.urlNew)
      ];
      gTracker.tabs[idTab] = {
        idVideosAvailable: [videoIdNew]
      };

      const isVideoPage = Boolean(videoIdNew);
      const isRemoveTab = !isVideoPage || videoIdOld !== videoIdNew;
      if (isRemoveTab) {
        const iIdTab = gTracker.videoIds[videoIdNew].indexOf(idTab);
        gTracker.videoIds[videoIdNew].splice(iIdTab, 1);
      }

      if (
        getIsFoundVideoIdInAnotherTab({
          tabs: gTracker.tabs,
          tabTracked
        })
      ) {
        return;
      }

      cancelOngoingDownloads();
      await removeVideosFromQueue(
        tabTracked.idVideosToDownload || tabTracked.idVideosAvailable
      );
    }
  });

  port.onDisconnect.addListener(async () => {
    const { id: idTab } = port.sender.tab;
    const tabTracked = gTracker.tabs[idTab];
    delete gTracker.tabs[idTab];

    tabTracked.idVideosAvailable.forEach(videoId => {
      const iIdTab = gTracker.videoIds[videoId].indexOf(idTab);
      gTracker.videoIds[videoId].splice(iIdTab, 1);
    });

    if (
      getIsFoundVideoIdInAnotherTab({
        tabs: gTracker.tabs,
        tabTracked
      })
    ) {
      return;
    }

    cancelOngoingDownloads();
    await removeVideosFromQueue(
      tabTracked.idVideosToDownload || tabTracked.idVideosAvailable
    );
  });
}

function deleteFiles(files: string[]) {
  files.forEach(file => gFfmpeg.FS("unlink", file));
}

function mimeToExt(response: Response): string {
  return response.headers.get("Content-Type").split("/").pop();
}

async function processMedia({
  urls,
  filenameOutput,
  videoId
}: {
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
    gTracker.videoIds[videoId].forEach(tabId => {
      chrome.tabs.sendMessage(tabId, {
        updateProgress: {
          videoId,
          progress: ratio
        }
      });
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
  port.onMessage.addListener(
    async (processInfo: {
      type: "video+audio" | "video" | "audio";
      urls: {
        video: string;
        audio: string;
      };
      filenameOutput: string;
      videoId: string;
      isOverride?: true;
    }) => {
      gTracker.videoDetails[processInfo.videoId] = {
        urls: { ...processInfo.urls },
        filenameOutput: processInfo.filenameOutput
      };

      if (!gVideoQueue.value.includes(processInfo.videoId)) {
        if (processInfo.isOverride) {
          gVideoQueue.value.unshift(processInfo.videoId);
          if (gVideoQueue.value.length > 1) {
            await restartFFmpeg();
          }
        } else {
          gVideoQueue.value.push(processInfo.videoId);
        }
      }
      // if (processInfo.type === "video+audio") {
      // } else if (processInfo.type === "video") {
      //   const videoDetail = gTracker.videoDetails[processInfo.videoId];
      //   saveAs(videoDetail.urls.video, videoDetail.filenameOutput);
      //   gVideoQueue.value.splice(0, 1);
      // } else if (processInfo.type === "audio") {
      //   // TODO: Download only audio as MP3 after being processed by Browser ID3 Writer
      // }
    }
  );
}

function removeVideoIdsFromTabs(videoIdsToCancel: string[]) {
  for (const videoId of videoIdsToCancel) {
    for (const tabId in gTracker.tabs) {
      const { idVideosToDownload } = gTracker.tabs[tabId];
      if (idVideosToDownload?.includes?.(videoId)) {
        const iVideo = idVideosToDownload.indexOf(videoId);
        idVideosToDownload.splice(iVideo, 1);
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

  chrome.runtime.onMessage.addListener(async message => {
    if (message.action === "cancel-download") {
      removeVideoIdsFromTabs(message.videoIdsToCancel);
      cancelOngoingDownloads();
      await removeVideosFromQueue(message.videoIdsToCancel);
    }
  });
}

async function processCurrentVideoWhenAvailable() {
  const delay = () => new Promise(resolve => setTimeout(resolve, 500));
  while (1) {
    const videoId = gVideoQueue.value[0];
    if (!videoId) {
      await delay();
      continue;
    }

    await processMedia({
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
