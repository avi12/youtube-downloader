import type { PlayerResponse } from "./types";
import {
  gIntersectionObserverModal,
  gIntersectionObserverTooltipSingleVideo,
  handleVideo,
  onQualityChange
} from "./yt-downloader-content-script-video";
import {
  appendPlaylistDownloadButton,
  getVideosContainer,
  gMutationObserverPlaylistProgress,
  gMutationObserverPlaylistVideoReadiness,
  handlePlaylistVideos
} from "./yt-downloader-content-script-playlist";
import { getVideoEventually } from "./utils";
import Port = chrome.runtime.Port;

export let gPorts: {
  main?: Port;
  processSingle?: Port;
  processPlaylist?: Port;
};

let isPortDisconnected = false;

let gObserverPlaylistVideos: MutationObserver;
let gObserverPlaylistDownloadButton: MutationObserver;
const gObserverOptions: MutationObserverInit = {
  subtree: true,
  childList: true
};

export function getIsLive(videoData: PlayerResponse): boolean {
  return videoData.videoDetails.isLive;
}

export function getIsDownloadable(videoData: PlayerResponse): boolean {
  return (
    !isPortDisconnected &&
    !getIsLive(videoData) &&
    videoData.playabilityStatus.status === "OK"
  );
}

export let gCancelControllers: AbortController[] = [];

function attachToBackground() {
  gPorts = {
    main: chrome.runtime.connect({ name: "main-connection" }),
    processSingle: chrome.runtime.connect({ name: "process-single" }),
    processPlaylist: chrome.runtime.connect({ name: "process-playlist" })
  };

  gPorts.main.onDisconnect.addListener(() => (isPortDisconnected = true));
}

function cancelDownloads() {
  if (gCancelControllers.length === 0) {
    return;
  }
  gCancelControllers.forEach(controller => {
    controller.abort();
  });
  gCancelControllers = [];
}

function resetObservers() {
  gObserverPlaylistVideos = null;
  gObserverPlaylistDownloadButton = null;

  gIntersectionObserverModal?.disconnect();
  gIntersectionObserverTooltipSingleVideo?.disconnect();
  gMutationObserverPlaylistProgress?.disconnect();
  gMutationObserverPlaylistVideoReadiness?.disconnect();
}

function removeDownloadButtonsOnPlaylists() {
  for (const elDownloadContainerOrCheckbox of document.querySelectorAll(
    ".ytdl-container, .ytdl-playlist-checkbox-container"
  )) {
    elDownloadContainerOrCheckbox.remove();
  }
}

async function removeEventListeners() {
  (await getVideoEventually()).removeEventListener("canplay", onQualityChange);

  const elVideoContainer = getVideosContainer();
  elVideoContainer.removeEventListener("change", onQualityChange);
}

function addNavigationListener() {
  let titleLast = document.title;
  new MutationObserver(async mutations => {
    const title = mutations[0].addedNodes[0].textContent;
    if (titleLast === title) {
      return;
    }
    titleLast = title;

    gPorts.main.postMessage({
      action: "navigated",
      urlNew: location.href
    });

    cancelDownloads();
    resetObservers();
    removeDownloadButtonsOnPlaylists();
    await removeEventListeners();
    await init();
  }).observe(document.querySelector("title"), { childList: true });
}

async function init() {
  const isValidPage = Boolean(location.pathname.match(/watch|playlist/));
  if (!isValidPage) {
    return;
  }

  const isVideo = Boolean(location.pathname === "/watch");
  if (isVideo) {
    await handleVideo();
    return;
  }

  if (!gObserverPlaylistVideos) {
    gObserverPlaylistVideos = new MutationObserver(async mutations => {
      if (
        !(<HTMLElement>mutations[1]?.addedNodes?.[0])?.matches?.(
          "ytd-playlist-video-renderer"
        )
      ) {
        return;
      }
      await handlePlaylistVideos();
    });
  }

  if (!gObserverPlaylistDownloadButton) {
    gObserverPlaylistDownloadButton = new MutationObserver(
      appendPlaylistDownloadButton
    );
  }

  gObserverPlaylistVideos.observe(
    document.querySelector("#contents"),
    gObserverOptions
  );

  gObserverPlaylistDownloadButton.observe(
    document.querySelector("ytd-menu-renderer"),
    gObserverOptions
  );

  appendPlaylistDownloadButton();
  await handlePlaylistVideos();
}

new MutationObserver(async (_, observer) => {
  const isReadyForProcessing = Boolean(document.querySelector("title"));
  if (!isReadyForProcessing) {
    return;
  }

  observer.disconnect();

  attachToBackground();
  addNavigationListener();

  await init();
}).observe(document.documentElement, gObserverOptions);
