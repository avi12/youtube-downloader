import { createFFmpeg, fetchFile, FFmpeg } from "@ffmpeg/ffmpeg";
import { saveAs } from "file-saver";
import { getVideoId, setStorage } from "./utils";
import type { Tab, TabHolder, Tracker, VideoQueue } from "./types";
import { ref, watch } from "@vue/runtime-core";
import Port = chrome.runtime.Port;

const gCancelControllers: { [videoId: string]: AbortController[] } = {};
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

function cancelOngoingDownloads(videoIds?: string[]) {
  if (!videoIds) {
    videoIds = Object.keys(gCancelControllers);
  }

  videoIds.forEach(videoId => {
    gCancelControllers[videoId].forEach(controller => {
      try {
        controller.abort();
        // eslint-disable-next-line no-empty
      } catch {}
    });

    delete gCancelControllers[videoId];
  });
}

async function removeVideosFromQueue(idsToRemove: string[]) {
  const iFirstProcessingInProgress = idsToRemove.indexOf(gVideoQueue.value[0]);

  idsToRemove.forEach(idToRemove => {
    const iVideo = gVideoQueue.value.indexOf(idToRemove);
    if (iVideo > -1) {
      gVideoQueue.value.splice(iVideo, 1);
    }
  });

  cancelOngoingDownloads(idsToRemove);

  if (iFirstProcessingInProgress > -1) {
    await restartFFmpeg();
  }
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
        const iIdTab = gTracker.videoIds[videoIdNew]?.indexOf(idTab);
        if (iIdTab !== undefined) {
          gTracker.videoIds[videoIdNew].splice(iIdTab, 1);
        }
      }

      if (
        getIsFoundVideoIdInAnotherTab({
          tabs: gTracker.tabs,
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

      gTracker.videoIds[videoId].forEach(tabId => {
        chrome.tabs.sendMessage(tabId, {
          updateProgress: {
            videoId,
            progress: receivedLength / totalLength,
            progressType
          }
        });
      });
    }

    const chuncksAll = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
      chuncksAll.set(chunk, position);
      position += chunk.length;
    }

    return chuncksAll;
  };

  gTracker.videoDetails[videoId] = {
    urls: {
      video: urls.video,
      audio: urls.audio
    },
    filenameOutput
  };

  const videoAbortController = new AbortController();
  const audioAbortController = new AbortController();

  gCancelControllers[videoId] = [videoAbortController, audioAbortController];

  const [responseVideo, responseAudio] = await Promise.all([
    fetch(urls.video, { signal: videoAbortController.signal }),
    fetch(urls.audio, { signal: audioAbortController.signal })
  ]);

  const [filenameVideo, filenameAudio, filenameOutputTemp] = [
    `${videoId}-video.${mimeToExt(responseVideo)}`,
    `${videoId}-audio.${mimeToExt(responseAudio)}`,
    `${videoId}-output.mp4`
  ];

  try {
    deleteFiles([filenameVideo, filenameAudio, filenameOutputTemp]);
    // eslint-disable-next-line no-empty
  } catch {}

  gFfmpeg.setProgress(({ ratio }) => {
    gTracker.videoIds[videoId].forEach(tabId => {
      chrome.tabs.sendMessage(tabId, {
        updateProgress: {
          videoId,
          progress: ratio,
          progressType: "ffmpeg"
        }
      });
    });
  });

  gFfmpeg.FS(
    "writeFile",
    filenameVideo,
    await fetchFile(await responseToUintArray(responseVideo, videoId))
  );

  gFfmpeg.FS(
    "writeFile",
    filenameAudio,
    await fetchFile(await responseToUintArray(responseAudio, videoId))
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
        gTracker.videoDetails[processInfo.videoId] = {
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

      gTracker.tabs[port.sender.tab.id].idVideosToDownload = videoIds;
      const wasPlaylistEmpty = gVideoQueue.value.length === 0;
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
