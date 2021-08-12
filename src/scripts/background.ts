import { createFFmpeg, fetchFile, FFmpeg } from "@ffmpeg/ffmpeg";
import { saveAs } from "file-saver";
import { getMediaId, getStorage, setStorage } from "./utils";
import Port = chrome.runtime.Port;
import type { MediaType, Tracker } from "./types";

let gCancelControllers: AbortController[] = [];
let gFfmpeg: FFmpeg;

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

async function handleMainConnection(port: Port) {
  const { url, id: idTab } = port.sender.tab;
  const tracker = (await getStorage("local", "tracker")) as Tracker;
  tracker.tabs[idTab] = {
    type: getMediaType(url),
    idMedia: getMediaId(url)
  };

  await setStorage("local", "tracker", tracker);

  const removeVideosFromQueue = async (idsToRemove: string[]) => {
    const iLastProcessingInProgress = idsToRemove.indexOf(
      tracker.videoQueue[0]
    );

    if (iLastProcessingInProgress > -1) {
      tracker.videoQueue.shift();
      idsToRemove.splice(iLastProcessingInProgress, 1);
    }

    idsToRemove.forEach(idToRemove => {
      const iVideo = tracker.videoQueue.indexOf(idToRemove);
      if (iVideo > -1) {
        tracker.videoQueue.splice(iVideo, 1);
      }
    });

    await setStorage("local", "tracker", tracker);

    cancelOngoingDownloads();
    await exitFFmpeg();
  };

  port.onMessage.addListener(async message => {
    if (message.action === "navigated") {
      const { id: idTab } = port.sender.tab;
      const tabTracked = tracker.tabs[idTab];

      tracker.tabs[idTab] = {
        type: getMediaType(message.newUrl),
        idMedia: getMediaId(message.newUrl)
      };

      await setStorage("local", "tracker", tracker);

      cancelOngoingDownloads();
      if (tabTracked.type === "playlist") {
        const { idVideos } = tabTracked;
        if (idVideos) {
          await removeVideosFromQueue(idVideos);
        }
        return;
      }

      await removeVideosFromQueue([tabTracked.idMedia]);
    } else if (message.action === "cancel-download") {
      const { id: idTab } = port.sender.tab;
      const tabTracked = tracker.tabs[idTab];

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
    const tabTracked = tracker.tabs[idTab];
    delete tracker.tabs[idTab];

    await setStorage("local", "tracker", tracker);

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
  port,
  urls,
  filenameOutput,
  videoId
}: {
  port: Port;
  urls: {
    video: string;
    audio: string;
  };
  filenameOutput: string;
  videoId: string;
}) {
  const tracker = (await getStorage("local", "tracker")) as Tracker;

  tracker.videoDetails[videoId] = {
    urls: {
      video: urls.video,
      audio: urls.audio
    },
    filenameOutput
  };

  await setStorage("local", "tracker", tracker);

  const videoAbortController = new AbortController();
  const audioAbortController = new AbortController();

  gCancelControllers.push(videoAbortController, audioAbortController);

  const [responseVideo, responseAudio] = await Promise.all([
    fetch(urls.video, { signal: videoAbortController.signal }),
    fetch(urls.audio, { signal: audioAbortController.signal })
  ]);

  const [filenameVideo, filenameAudio] = [
    `${videoId}-video.${mimeToExt(responseVideo)}`,
    `${videoId}-audio.${mimeToExt(responseAudio)}`
  ];

  gFfmpeg.setProgress(({ ratio }) =>
    port.postMessage({
      progress: ratio
    })
  );

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
    filenameOutput
  );

  const dataFile = gFfmpeg.FS("readFile", filenameOutput);

  deleteFiles([filenameVideo, filenameAudio, filenameOutput]);
  saveAs(new Blob([dataFile.buffer]), filenameOutput);

  const iVideo = tracker.videoQueue.indexOf(videoId);
  tracker.videoQueue.splice(iVideo, 1);
  await setStorage("local", "tracker", tracker);
}

async function abortAndProcessVideoQueue(port: Port) {
  const tracker = (await getStorage("local", "tracker")) as Tracker;

  cancelOngoingDownloads();
  await restartFFmpeg();

  for (const videoId of tracker.videoQueue) {
    await processMedia({
      port,
      ...tracker.videoDetails[videoId],
      videoId
    });
  }
}

function handleMediaProcessing(port: Port) {
  port.onMessage.addListener(async processInfo => {
    const tracker = (await getStorage("local", "tracker")) as Tracker;
    if (!tracker.videoQueue.includes(processInfo.videoId)) {
      tracker.videoQueue.unshift(processInfo.videoId);
    }
    tracker.videoDetails[processInfo.videoId] = {
      urls: { ...processInfo.urls },
      filenameOutput: processInfo.filenameOutput
    };
    await setStorage("local", "tracker", tracker);

    if (processInfo.type === "video+audio") {
      await abortAndProcessVideoQueue(port);
    } else if (processInfo.type === "video") {
      const videoDetail = tracker.videoDetails[processInfo.videoId];
      const response = await fetch(videoDetail.urls.video);
      saveAs(new Blob([await response.blob()]), videoDetail.filenameOutput);
    } else if (processInfo.type === "audio") {
      // TODO: Download only audio as MP3 after being processed by Browser ID3 Writer
    }
  });
}

function listenToTabs() {
  chrome.runtime.onConnect.addListener(async port => {
    if (port.name === "main-connection") {
      await handleMainConnection(port);
    } else if (port.name === "process-media") {
      handleMediaProcessing(port);
    }
  });
}

async function init() {
  await setStorage("local", "tracker", {
    videoQueue: [],
    videoDetails: {},
    tabs: {}
  } as Tracker);

  listenToTabs();
}

init();
