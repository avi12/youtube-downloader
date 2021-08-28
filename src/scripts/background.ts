import {
  createFFmpeg,
  fetchFile,
  FFmpeg
} from "@ffmpeg/ffmpeg/dist/ffmpeg.min.js";
import { saveAs } from "file-saver";
import { getVideoId, hasOwnProperty, setStorage } from "./utils";
import type {
  Tab,
  TabTracker,
  VideoDetails,
  VideoIds,
  VideoQueue
} from "./types";
import { Ref, watch } from "@vue/runtime-core";
import { ref } from "@vue/reactivity";
import Port = chrome.runtime.Port;

const gCancelControllers: { [videoId: string]: AbortController[] } = {};
let gFfmpeg: FFmpeg;
const gTabTracker = ref<TabTracker>({});
const gVideoIds = ref<VideoIds>({});
const gVideoDetails = ref<VideoDetails>({});
const gVideoQueue = ref<VideoQueue>([]);

function getLogColor(): string {
  const color = matchMedia("(prefers-color-scheme: dark)").matches
    ? "cyan"
    : "red";
  return `color: ${color}`;
}

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
  await setStorage("local", "isFFmpegReady", false);

  gFfmpeg = createFFmpeg({ log: true });
  await gFfmpeg.load();

  await setStorage("local", "isFFmpegReady", true);
}

async function restartFFmpeg() {
  exitFFmpeg();
  await initializeFFmpeg();
  await processCurrentVideoWhenAvailable();
}

function cancelOngoingDownloads(videoIds = Object.keys(gCancelControllers)) {
  videoIds.forEach(videoId => {
    // for (const mediaType in gCancelDownloads[videoId]) {
    //   gCancelDownloads[videoId][mediaType] = true;
    // }
    gCancelControllers[videoId]?.forEach(controller => {
      try {
        controller.abort();
        // eslint-disable-next-line no-empty
      } catch {}
    });
  });
}

async function removeVideosFromQueue(idsToRemove: string[]) {
  const isFirstProcessingInProgress = idsToRemove.includes(
    gVideoQueue.value[0]
  );

  idsToRemove.forEach(videoId => {
    const iVideoId = gVideoQueue.value.indexOf(videoId);
    if (iVideoId > -1) {
      gVideoQueue.value.splice(iVideoId, 1);
    }
  });

  cancelOngoingDownloads(idsToRemove);

  if (isFirstProcessingInProgress) {
    await restartFFmpeg();
  }
}

function getIsFoundVideoIdInAnotherTab({
  tabs,
  tabTracked
}: {
  tabs: TabTracker | Ref<TabTracker>;
  tabTracked: Tab;
}): boolean {
  for (const tabId in tabs) {
    if (!hasOwnProperty(tabs, tabId)) {
      continue;
    }
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
  gTabTracker.value[idTab] = {
    idVideosAvailable: [videoId]
  };

  const isVideoPage = Boolean(videoId);
  if (isVideoPage) {
    if (!gVideoIds.value[videoId]) {
      gVideoIds.value[videoId] = [idTab];
    } else {
      gVideoIds.value[videoId].push(idTab);
    }
  }

  port.onMessage.addListener(async message => {
    if (message.action === "insert-playlist-videos") {
      gTabTracker.value[idTab].idVideosAvailable = message.videoIds;
      message.videoIds.forEach(videoId => {
        if (!gVideoIds.value[videoId]) {
          gVideoIds.value[videoId] = [];
        }
        gVideoIds.value[videoId].push(idTab);
      });
      return;
    }

    if (message.action === "navigated") {
      const { id: idTab, url: urlOld } = port.sender.tab;
      const tabTracked = gTabTracker.value[idTab];

      const [videoIdOld, videoIdNew] = [
        getVideoId(urlOld),
        getVideoId(message.urlNew)
      ];
      gTabTracker.value[idTab] = {
        idVideosAvailable: [videoIdNew]
      };

      const isVideoPage = Boolean(videoIdNew);
      const isRemoveTab = !isVideoPage || videoIdOld !== videoIdNew;
      if (isRemoveTab) {
        const iIdTab = gVideoIds.value[videoIdNew]?.indexOf(idTab);
        if (iIdTab !== undefined) {
          gVideoIds.value[videoIdNew].splice(iIdTab, 1);
        }
      }

      if (
        getIsFoundVideoIdInAnotherTab({
          tabs: gTabTracker,
          tabTracked
        })
      ) {
        return;
      }

      await removeVideosFromQueue(
        tabTracked.idVideosToDownload || tabTracked.idVideosAvailable
      );
    }
  });

  port.onDisconnect.addListener(async () => {
    const { id: idTab } = port.sender.tab;
    const tabTracked = gTabTracker.value[idTab];
    delete gTabTracker.value[idTab];

    const idVideosToDownload =
      tabTracked.idVideosToDownload || tabTracked.idVideosAvailable;

    idVideosToDownload.forEach(videoId => {
      const tab = gVideoIds.value[videoId];
      if (!tab) {
        return;
      }
      const iIdTab = tab.indexOf(idTab);
      tab.splice(iIdTab, 1);
    });

    if (
      getIsFoundVideoIdInAnotherTab({
        tabs: gTabTracker,
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
  const responseToUintArray: (
    response: Response,
    videoId
  ) => Promise<Uint8Array> = async (response: Response, videoId: string) => {
    // https://javascript.info/fetch-progress
    const reader = response.body.getReader();
    const totalLength = +response.headers.get("Content-Length");
    const progressType = response.headers.get("Content-Type").split("/")[0];

    let receivedLength = 0;
    const chunks: Uint8Array[] = [];

    while (1) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      chunks.push(value);
      receivedLength += value.length;

      const progress = receivedLength / totalLength;

      gVideoIds.value[videoId].forEach(tabId => {
        chrome.tabs.sendMessage(tabId, {
          updateProgress: {
            videoId,
            progress,
            progressType
          }
        });
      });

      await setStorage("local", "statusProgress", {
        type: progressType,
        progress
      });
    }

    const chunksAll = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      chunksAll.set(chunk, position);
      position += chunk.length;
    }

    return chunksAll;
  };

  gVideoDetails.value[videoId] = {
    urls: {
      video: urls.video,
      audio: urls.audio
    },
    filenameOutput
  };

  // gCancelDownloads[videoId] = {
  //   video: false,
  //   audio: false
  // };

  const abortVideo = new AbortController();
  const abortAudio = new AbortController();
  gCancelControllers[videoId] = [abortVideo, abortAudio];

  const [responseVideo, responseAudio] = await Promise.all([
    fetch(urls.video, { signal: abortVideo.signal }),
    fetch(urls.audio, { signal: abortAudio.signal })
  ]);
  const [filenameVideo, filenameAudio, filenameOutputTemp] = [
    `${videoId}-video.${mimeToExt(responseVideo)}`,
    `${videoId}-audio.${mimeToExt(responseAudio)}`,
    `${videoId}-output.mp4`
  ];

  gFfmpeg.setProgress(({ ratio }) => {
    gVideoIds.value[videoId].forEach(tabId => {
      chrome.tabs.sendMessage(tabId, {
        updateProgress: {
          videoId,
          progress: ratio,
          progressType: "ffmpeg"
        }
      });
    });

    chrome.storage.local.set({
      statusProgress: {
        type: "ffmpeg",
        progress: ratio
      }
    });
  });

  const [blobVideo, blobAudio] = await Promise.all([
    fetchFile(await responseToUintArray(responseVideo, videoId)),
    fetchFile(await responseToUintArray(responseAudio, videoId))
  ]);

  gFfmpeg.FS("writeFile", filenameVideo, blobVideo);
  gFfmpeg.FS("writeFile", filenameAudio, blobAudio);

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

function handleSingleMediaProcessing(port: Port) {
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
      gVideoDetails.value[processInfo.videoId] = {
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
      //   const videoDetail = gVideoDetails.value[processInfo.videoId];
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
    for (const tabId in gTabTracker.value) {
      const { idVideosToDownload } = gTabTracker.value[tabId];
      if (idVideosToDownload?.includes(videoId)) {
        const iVideo = idVideosToDownload.indexOf(videoId);
        idVideosToDownload.splice(iVideo, 1);
      }
    }
  }
}

function handlePlaylistProcessing(port: Port) {
  port.onMessage.addListener(
    async (
      processInfos: {
        type: "video+audio" | "video" | "audio";
        urls: {
          video: string;
          audio: string;
        };
        filenameOutput: string;
        videoId: string;
      }[]
    ) => {
      processInfos.forEach(processInfo => {
        gVideoDetails.value[processInfo.videoId] = {
          urls: { ...processInfo.urls },
          filenameOutput: processInfo.filenameOutput
        };
      });

      const videoIds = processInfos.reduce(
        (videoIds: string[], processInfo) => {
          if (processInfo.type === "video+audio") {
            videoIds.push(processInfo.videoId);
          }
          return videoIds;
        },
        []
      );

      const wasPlaylistEmpty = gVideoQueue.value.length === 0;
      gTabTracker.value[port.sender.tab.id].idVideosToDownload = videoIds;
      gVideoQueue.value.unshift(...videoIds);

      if (!wasPlaylistEmpty) {
        await restartFFmpeg();
      }
    }
  );
}

function listenToTabs() {
  chrome.runtime.onConnect.addListener(async port => {
    if (port.name === "main-connection") {
      await handleMainConnection(port);
    } else if (port.name === "process-single") {
      handleSingleMediaProcessing(port);
    } else if (port.name === "process-playlist") {
      handlePlaylistProcessing(port);
    }
  });

  chrome.runtime.onMessage.addListener(async message => {
    if (message.action === "cancel-download") {
      removeVideoIdsFromTabs(message.videoIdsToCancel);
      await removeVideosFromQueue(message.videoIdsToCancel);
    }
  });
}

async function processCurrentVideoWhenAvailable() {
  const delay = () => new Promise(resolve => setTimeout(resolve, 500));
  while (1) {
    const videoId = gVideoQueue.value[0];
    if (!videoId || !gFfmpeg.isLoaded()) {
      await delay();
      continue;
    }

    await processMedia({
      videoId,
      ...gVideoDetails.value[videoId]
    });
  }
}

function addListeners() {
  chrome.storage.onChanged.addListener(async changes => {
    const videoQueueCurrent = changes.videoQueue?.newValue as VideoQueue;
    if (!videoQueueCurrent) {
      return;
    }
    const videoQueuePrev = changes.videoQueue.oldValue;

    if (
      videoQueueCurrent.length > 0 &&
      videoQueuePrev.length > 0 &&
      videoQueueCurrent[0] !== videoQueuePrev[0]
    ) {
      cancelOngoingDownloads(videoQueueCurrent);
      gVideoQueue.value = videoQueueCurrent;
      await restartFFmpeg();
    }
  });
}

function addWatchers() {
  watch(gVideoQueue, videoQueue => {
    setStorage("local", "videoQueue", videoQueue);
  });

  watch(gTabTracker, tabTracker => {
    setStorage("local", "tabTracker", tabTracker);
  });

  watch(gVideoDetails, videoDetails =>
    setStorage("local", "videoDetails", videoDetails)
  );

  watch(gVideoIds, videoIds => setStorage("local", "videoIds", videoIds));
}

chrome.runtime.onInstalled.addListener(emptyTempStorage);

function emptyTempStorage() {
  chrome.storage.local.set({
    videoQueue: [],
    tabTracker: {},
    videoDetails: {},
    videoIds: {}
  });
}

async function init() {
  addWatchers();
  listenToTabs();
  addListeners();
  await initializeFFmpeg();
  await processCurrentVideoWhenAvailable();
}

init();
