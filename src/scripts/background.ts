import { createFFmpeg, fetchFile, FFmpeg } from "@ffmpeg/ffmpeg/dist/ffmpeg.min.js";
import { getCompatibleFilename, getMimeType, getVideoId, setLocalStorage, updateQueue } from "./utils";
import type {
  MusicList,
  StatusProgress,
  TabTracker,
  VideoDetails,
  VideoIds,
  VideoOnlyList,
  VideoQueue
} from "./types";
import { watch } from "@vue/runtime-core";
import { ref } from "@vue/reactivity";

const gCancelControllers: {
  [videoId: string]: {
    isAborted: boolean;
    abortControllers: AbortController[];
  };
} = {};
let gFfmpeg: FFmpeg;
const gTabTracker: TabTracker = {};
const gVideoDetails = ref<VideoDetails>({});
const gStatusProgress = ref<StatusProgress>({});
const gVideoIds: VideoIds = {};

let gMusicList: MusicList = [];
let gVideoQueue: VideoQueue = [];
let gVideoOnlyList: VideoOnlyList = [];

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
  await setLocalStorage("isFFmpegReady", false);

  gFfmpeg = createFFmpeg({ log: true });
  await gFfmpeg.load();

  await setLocalStorage("isFFmpegReady", true);
}

async function restartFFmpeg() {
  exitFFmpeg();
  await initializeFFmpeg();
  processCurrentVideoWhenAvailable();
}

function cancelOngoingDownloads(videoIds = Object.keys(gCancelControllers)) {
  videoIds.forEach(videoId => {
    gCancelControllers[videoId]?.abortControllers.forEach(controller => {
      controller.abort();

      delete gStatusProgress.value[videoId];
    });
  });
}

async function removeMediaFromLists(idsToRemove: string[]) {
  const isFirstProcessingInProgress = idsToRemove.includes(gVideoQueue[0]);

  gMusicList = gMusicList.filter(videoId => !idsToRemove.includes(videoId));
  gVideoQueue = gVideoQueue.filter(videoId => !idsToRemove.includes(videoId));
  gVideoOnlyList = gVideoOnlyList.filter(videoId => !idsToRemove.includes(videoId));

  await updateQueue("music", gMusicList);
  await updateQueue("video", gVideoQueue);
  await updateQueue("videoOnly", gVideoOnlyList);

  cancelOngoingDownloads(idsToRemove);
  idsToRemove.forEach(videoId => {
    delete gCancelControllers[videoId];
  });

  if (isFirstProcessingInProgress) {
    restartFFmpeg();
  }
}

function addVideoTabTracker(videoId: string, tabId: number) {
  if (!gVideoIds[videoId]) {
    gVideoIds[videoId] = [tabId];
  } else {
    gVideoIds[videoId].push(tabId);
  }
}

function removeVideoTabTracker(videoIdToRemove: string, tabId: number) {
  const iTabId = gVideoIds[videoIdToRemove].indexOf(tabId);
  gVideoIds[videoIdToRemove].splice(iTabId, 1);
}

function handleMainConnection(port: chrome.runtime.Port) {
  const { url, id: idTab } = port.sender.tab;

  const videoId = getVideoId(url);
  gTabTracker[idTab] = {
    videoIdsAvailable: [videoId]
  };

  addVideoTabTracker(videoId, idTab);

  port.onMessage.addListener(async message => {
    if (message.action === "insert-video-to-playlist") {
      gTabTracker[idTab].videoIdsAvailable.push(message.videoId);
      addVideoTabTracker(message.videoId, idTab);
      return;
    }

    if (message.action === "navigated") {
      const { id: idTab, url: urlOld } = port.sender.tab;
      const tabTracked = gTabTracker[idTab];

      const idVideoNew = getVideoId(message.urlNew);
      const idVideoOld = getVideoId(urlOld);

      gTabTracker[idTab] = {
        videoIdsAvailable: [idVideoNew]
      };

      removeVideoTabTracker(idVideoOld, idTab);
      addVideoTabTracker(idVideoNew, idTab);

      await removeMediaFromLists(tabTracked.videoIdsToDownload || tabTracked.videoIdsAvailable);
    }
  });

  port.onDisconnect.addListener(async () => {
    const { id: idTab, url } = port.sender.tab;
    const tabTracked = gTabTracker[idTab];
    delete gTabTracker[idTab];

    const videoId = getVideoId(url);
    // Could be a /playlist page,
    // in which case there wouldn't be a video ID
    if (videoId) {
      removeVideoTabTracker(videoId, idTab);
    }

    await removeMediaFromLists(tabTracked.videoIdsToDownload || tabTracked.videoIdsAvailable);
  });
}

function deleteFiles(files: string[]) {
  files.forEach(file => gFfmpeg.FS("unlink", file));
}

function mimeToExt(response: Response): string {
  return response.headers.get("Content-Type").split("/").pop();
}

async function responseToUintArray(response: Response, videoId: string) {
  // https://javascript.info/fetch-progress
  const reader = response.body.getReader();
  const totalLength = +response.headers.get("Content-Length");
  const progressType = response.headers.get("Content-Type").split("/")[0] as "audio" | "video";

  let receivedLength = 0;
  const chunks: Uint8Array[] = [];

  while (1) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    chunks.push(value);
    receivedLength += value.length;

    updateProgress({
      videoId,
      progressType,
      progress: receivedLength / totalLength
    });
  }
  const chunksAll = new Uint8Array(receivedLength);
  let position = 0;
  for (const chunk of chunks) {
    chunksAll.set(chunk, position);
    position += chunk.length;
  }

  return chunksAll;
}

function updateProgress({
  videoId,
  progress,
  progressType
}: {
  videoId: string;
  progress: number;
  progressType: "ffmpeg" | "video" | "audio";
}) {
  if (gCancelControllers[videoId]?.isAborted ?? true) {
    return;
  }
  gVideoIds[videoId].forEach(tabId => {
    chrome.tabs.sendMessage(tabId, {
      updateProgress: {
        videoId,
        progress,
        progressType
      }
    });
  });

  gStatusProgress.value[videoId] = {
    progress,
    progressType
  };
}

async function cleanupDownload({ url, videoId }: { url: string; videoId: string }) {
  URL.revokeObjectURL(url);
  delete gCancelControllers[videoId];
  delete gStatusProgress.value[videoId];

  await updateQueue("music", gMusicList);
  await updateQueue("video", gVideoQueue);
  await updateQueue("videoOnly", gVideoOnlyList);
}

function sendRemovalSignal(videoId: string) {
  delete gCancelControllers[videoId];
  gVideoIds[videoId].forEach(tabId =>
    chrome.tabs.sendMessage(tabId, {
      updateProgress: {
        videoId,
        isRemoved: true
      }
    })
  );
}

async function processVideo({
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
  gVideoDetails.value[videoId] = {
    urls: {
      video: urls.video,
      audio: urls.audio
    },
    filenameOutput
  };

  const abortControllers = [new AbortController(), new AbortController()];

  let abortCount = 0;
  const onAbort = () => {
    gCancelControllers[videoId].isAborted = true;
    abortCount++;
    if (abortCount < abortControllers.length) {
      return;
    }
    sendRemovalSignal(videoId);
  };

  const [abortVideo, abortAudio] = abortControllers;

  abortVideo.signal.addEventListener("abort", onAbort, { once: true });
  abortAudio.signal.addEventListener("abort", onAbort, { once: true });

  gCancelControllers[videoId] = {
    isAborted: false,
    abortControllers
  };

  const [responseVideo, responseAudio] = await Promise.all([
    fetch(urls.video, { signal: abortVideo.signal }),
    fetch(urls.audio, { signal: abortAudio.signal })
  ]);
  const [filenameVideo, filenameAudio, filenameOutputTemp] = [
    `${videoId}-video.${mimeToExt(responseVideo)}`,
    `${videoId}-audio.${mimeToExt(responseAudio)}`,
    `${videoId}-${filenameOutput}`
  ].map(getCompatibleFilename);

  gFfmpeg.setProgress(async ({ ratio }) => {
    updateProgress({
      videoId,
      progress: ratio,
      progressType: "ffmpeg"
    });
  });

  const [blobVideo, blobAudio] = await Promise.all([
    fetchFile(await responseToUintArray(responseVideo, videoId)),
    fetchFile(await responseToUintArray(responseAudio, videoId))
  ]);

  gFfmpeg.FS("writeFile", filenameVideo, blobVideo);
  gFfmpeg.FS("writeFile", filenameAudio, blobAudio);

  await gFfmpeg.run("-i", filenameVideo, "-i", filenameAudio, "-c:v", "copy", filenameOutputTemp);

  const dataFile: Uint8Array = gFfmpeg.FS("readFile", filenameOutputTemp);
  deleteFiles([filenameVideo, filenameAudio, filenameOutputTemp]);

  const url = URL.createObjectURL(new Blob([dataFile], { type: getMimeType(filenameOutput) }));
  await processSingleMedia({
    videoId,
    type: "video+audio",
    filenameOutput,
    url
  });

  const iVideo = gVideoQueue.indexOf(videoId);
  gVideoQueue.splice(iVideo, 1);
  await updateQueue("video", gVideoQueue);
}

async function processSingleMedia({
  type,
  urls,
  url,
  filenameOutput,
  videoId
}: {
  type: "video+audio" | "video" | "audio";
  urls?: { video: string; audio: string };
  url?: string;
  filenameOutput: string;
  videoId: string;
}) {
  if (type !== "video+audio") {
    const abortMedia = new AbortController();
    gCancelControllers[videoId] = {
      isAborted: false,
      abortControllers: [abortMedia]
    };

    abortMedia.signal.addEventListener("abort", () => sendRemovalSignal(videoId), { once: true });
    const dataFile = await responseToUintArray(
      await fetch(urls[type], {
        signal: abortMedia.signal
      }),
      videoId
    );
    url = URL.createObjectURL(
      new Blob([dataFile.buffer], {
        type: getMimeType(filenameOutput)
      })
    );
  }

  chrome.downloads.download({ url, filename: getCompatibleFilename(filenameOutput) }, () =>
    cleanupDownload({
      url,
      videoId
    })
  );
}

function handleSingleMediaProcessing(port: chrome.runtime.Port) {
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
      const { videoId } = processInfo;

      gVideoDetails.value[videoId] = {
        urls: { ...processInfo.urls },
        filenameOutput: processInfo.filenameOutput
      };

      if (processInfo.type === "video+audio") {
        if (gVideoQueue.includes(videoId)) {
          return;
        }
        if (processInfo.isOverride) {
          gVideoQueue.unshift(videoId);
          if (gVideoQueue.length > 0) {
            restartFFmpeg();
          }
        } else {
          gVideoQueue.push(videoId);
        }
        await updateQueue("video", gVideoQueue);
        return;
      }

      await processSingleMedia(processInfo);
    }
  );
}

function removeVideoIdsFromTabs(videoIdsToCancel: string[]) {
  for (const videoId of videoIdsToCancel) {
    for (const tabId in gTabTracker) {
      const { videoIdsToDownload } = gTabTracker[tabId];
      if (videoIdsToDownload?.includes(videoId)) {
        const iVideo = videoIdsToDownload.indexOf(videoId);
        videoIdsToDownload.splice(iVideo, 1);
      }
    }
  }
}

async function processMusicPlaylist() {
  while (gMusicList.length > 0) {
    const videoId = gMusicList.shift();
    processSingleMedia({
      videoId,
      type: "audio",
      urls: {
        ...gVideoDetails.value[videoId].urls
      },
      filenameOutput: gVideoDetails.value[videoId].filenameOutput
    });
  }
}

async function processVideoOnlyPlaylist() {
  while (gVideoOnlyList.length > 0) {
    const videoId = gVideoOnlyList.shift();
    processSingleMedia({
      videoId,
      type: "video",
      urls: {
        ...gVideoDetails.value[videoId].urls
      },
      filenameOutput: gVideoDetails.value[videoId].filenameOutput
    });
  }
}

function handlePlaylistProcessing(port: chrome.runtime.Port) {
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
      const audioIds = [];
      const videoIds = [];
      const videoOnlyIds = [];

      processInfos.forEach(processInfo => {
        gVideoDetails.value[processInfo.videoId] = {
          urls: { ...processInfo.urls },
          filenameOutput: processInfo.filenameOutput
        };

        if (processInfo.type === "audio") {
          audioIds.push(processInfo.videoId);
        } else if (processInfo.type === "video+audio") {
          videoIds.push(processInfo.videoId);
        } else {
          videoOnlyIds.push(processInfo.videoId);
        }
      });

      const wasVideoQueueEmpty = gVideoQueue.length === 0;
      const isFirstVideoInProgress = gVideoQueue[0] === videoIds[0];

      gTabTracker[port.sender.tab.id].videoIdsToDownload = [...audioIds, ...videoIds, ...videoOnlyIds];

      gMusicList = gMusicList.filter(audioId => !audioIds.includes(audioId));
      gVideoQueue = gVideoQueue.filter(videoId => !videoIds.includes(videoId));
      gVideoOnlyList = gVideoOnlyList.filter(videoId => !videoOnlyIds.includes(videoId));

      gVideoQueue.unshift(...videoIds);
      gMusicList.unshift(...audioIds);
      gVideoOnlyList.unshift(...videoOnlyIds);

      await updateQueue("music", gMusicList);
      await updateQueue("video", gVideoQueue);
      await updateQueue("videoOnly", gVideoOnlyList);

      processMusicPlaylist();
      processVideoOnlyPlaylist();

      if (!wasVideoQueueEmpty && !isFirstVideoInProgress) {
        restartFFmpeg();
      }
    }
  );
}

function listenToTabs() {
  chrome.runtime.onConnect.addListener(async port => {
    if (port.name === "main-connection") {
      handleMainConnection(port);
    } else if (port.name === "process-single") {
      handleSingleMediaProcessing(port);
    } else if (port.name === "process-playlist") {
      handlePlaylistProcessing(port);
    }
  });

  chrome.runtime.onMessage.addListener(async message => {
    if (message.action === "cancel-download") {
      removeVideoIdsFromTabs(message.videoIdsToCancel);
      await removeMediaFromLists(message.videoIdsToCancel);
    }
  });
}

function delay() {
  return new Promise(resolve => setTimeout(resolve, 500));
}

async function processCurrentVideoWhenAvailable() {
  while (1) {
    const videoId = gVideoQueue[0];
    if (!videoId || !gFfmpeg.isLoaded()) {
      await delay();
      continue;
    }

    await processVideo({
      videoId,
      ...gVideoDetails.value[videoId]
    });
  }
}

function addListeners() {
  chrome.storage.onChanged.addListener(async changes => {
    const videoQueueCurrent = changes.videoQueue?.newValue as VideoQueue;
    const videoQueuePrev = changes.videoQueue?.oldValue as VideoQueue;
    if (!videoQueueCurrent || !videoQueuePrev) {
      return;
    }

    if (
      videoQueueCurrent.length > 0 &&
      videoQueuePrev.length > 0 &&
      videoQueueCurrent[0] !== videoQueuePrev[0]
    ) {
      cancelOngoingDownloads([videoQueueCurrent[0]]);
      gVideoQueue = videoQueueCurrent;
      await updateQueue("video", gVideoQueue);
      restartFFmpeg();
    }
  });
}

function addWatchers() {
  watch(gVideoDetails.value, videoDetails => chrome.storage.local.set({ videoDetails }));

  watch(gStatusProgress.value, statusProgress => chrome.storage.local.set({ statusProgress }));
}

chrome.runtime.onInstalled.addListener(emptyTempStorage);

async function emptyTempStorage() {
  chrome.storage.local.clear();
}

async function init() {
  addWatchers();
  listenToTabs();
  addListeners();
  await initializeFFmpeg();
  await processCurrentVideoWhenAvailable();
}

init();
