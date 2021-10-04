import type { MusicList, Options, VideoOnlyList, VideoQueue } from "./types";

// Storage utils
export async function updateQueue(
  queueType: "video" | "videoOnly" | "music",
  queueOrList: VideoQueue | MusicList | VideoOnlyList
): Promise<void> {
  if (queueType === "video") {
    await setLocalStorage("videoQueue", queueOrList);
    return;
  }
  await setLocalStorage(`${queueType}List`, queueOrList);
}

export async function getLocalStorage(
  key:
    | "musicList"
    | "videoQueue"
    | "videoOnlyList"
    | "tabTracker"
    | "videoDetails"
    | "videoIds"
    | "isFFmpegReady"
    | "statusProgress"
): Promise<unknown> {
  return new Promise(resolve =>
    chrome.storage.local.get(key, result => resolve(key ? result[key] : result))
  );
}

export async function setLocalStorage(
  key:
    | "musicList"
    | "videoQueue"
    | "videoOnlyList"
    | "tabTracker"
    | "videoDetails"
    | "videoIds"
    | "isFFmpegReady"
    | "statusProgress",
  value: unknown
): Promise<void> {
  return new Promise(resolve =>
    chrome.storage.local.set({ [key]: value }, resolve)
  );
}

// Element grabbing
async function getElementByMutationObserver(
  selector: string
): Promise<HTMLElement> {
  return new Promise(resolve => {
    const observerHtml = new MutationObserver((_, observer) => {
      const element = getVisibleElementInArray(selector);
      if (element) {
        observer.disconnect();
        resolve(element as HTMLElement);
      }
    });
    observerHtml.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}

async function getElementsByMutationObserver(
  selector: string
): Promise<HTMLElement[]> {
  return new Promise(resolve => {
    const observerHtml = new MutationObserver((_, observer) => {
      const elements = getVisibleElementsInArray(selector);
      if (elements) {
        observer.disconnect();
        resolve(elements as HTMLElement[]);
      }
    });
    observerHtml.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}

export function isElementVisible(element: HTMLElement | Element): boolean {
  return (
    (<HTMLElement>element)?.offsetWidth > 0 &&
    (<HTMLElement>element)?.offsetHeight > 0
  );
}

function getVisibleElementInArray(
  elements: NodeListOf<Element> | string
): HTMLElement {
  if (typeof elements === "string") {
    elements = document.querySelectorAll(elements);
  }
  return [...(elements as NodeListOf<HTMLElement>)].find(isElementVisible);
}

function getVisibleElementsInArray(
  elements: NodeListOf<Element> | string
): HTMLElement[] {
  if (typeof elements === "string") {
    elements = document.querySelectorAll(elements);
  }
  return [...(elements as NodeListOf<HTMLElement>)].filter(isElementVisible);
}

export async function getElementEventually(selector: string): Promise<Element> {
  const elements = document.querySelectorAll(selector);
  return (
    (elements.length > 0 && getVisibleElementInArray(elements)) ||
    (await getElementByMutationObserver(selector))
  );
}

export async function getVideoEventually(): Promise<HTMLVideoElement> {
  return new Promise(async resolve => {
    new MutationObserver((_, observer) => {
      const elVideo = document.querySelector("video");
      if (elVideo.videoHeight > 0) {
        observer.disconnect();
        resolve(elVideo);
      }
    }).observe(document.body, { subtree: true, childList: true });
  });
}

export async function getElementsEventually(
  selector: string
): Promise<Element[]> {
  const elements = document.querySelectorAll(selector);
  return (
    (elements.length > 0 && getVisibleElementsInArray(elements)) ||
    (await getElementsByMutationObserver(selector))
  );
}

export function getVideoId(url: string): string | null {
  const urlParams = new URLSearchParams(new URL(url).search);
  return urlParams.get("v");
}

// MIME types and filenames/file extensions
export function getCompatibleFilename(filename: string): string {
  if (navigator.appVersion.includes("Win")) {
    const forbiddenCharsWindows = /[<>:"\\/|*]/g;
    return filename.replace(forbiddenCharsWindows, "-").replaceAll("?", "");
  }

  if (navigator.appVersion.includes("Mac")) {
    const forbiddenCharsMac = /[/:]/g;
    return filename.replace(forbiddenCharsMac, "");
  }

  const forbiddenCharsLinux = /\//g;
  return filename.replace(forbiddenCharsLinux, "");
}

export const gExtToMimeAll = {
  au: "audio/basic",
  snd: "audio/basic",
  aif: "audio/x-aiff",
  aifc: "audio/x-aiff",
  aiff: "audio/x-aiff",
  m3u: "audio/x-mpegurl",
  ra: "audio/vnd.rn-realaudio",
  ram: "audio/vnd.rn-realaudio",
  aac: "audio/aac",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  ogg: "audio/ogg",
  ogv: "video/ogg",
  oga: "audio/ogg",
  spx: "audio/ogg",
  ogm: "audio/ogg",
  opus: "audio/opus",
  ts: "video/mp2t",
  wav: "audio/vnd.wav",
  weba: "audio/webm",
  webm: "video/webm",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2",
  mkv: "video/x-matroska"
};

export const gExtToMime = {
  video: Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Object.entries(gExtToMimeAll).filter(([_, mimeType]) =>
      mimeType.startsWith("video")
    )
  ),
  audio: Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    Object.entries(gExtToMimeAll).filter(([_, mimeType]) =>
      mimeType.startsWith("audio")
    )
  )
};

export const gSupportedExts = {
  video: Object.entries(gExtToMime.video).map(([ext]) => ext),
  audio: Object.entries(gExtToMime.audio).map(([ext]) => ext)
};

export function getMimeType(filename: string): string | undefined {
  return gExtToMimeAll[getFileExt(filename)];
}

export function getFileExt(filename: string): string {
  return filename.split(".").pop();
}

// Options
export const qualities = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144];
const qualityClosest = qualities.find(quality => quality <= screen.height);
export const initialOptions: Options = {
  ext: {
    audio: "mp3",
    video: "mp4"
  },
  videoQualityMode: "current-quality",
  videoQuality: qualityClosest,
  isRemoveNativeDownload: false
};

export function getDiffOption(
  options1: Options,
  options2: Options
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): { [p: string]: any } {
  return Object.fromEntries([
    Object.entries(options1).find(
      ([key, value]) =>
        JSON.stringify({ [key]: value }) !==
        JSON.stringify({ [key]: options2[key] })
    )
  ]);
}

export async function getStoredOptions(): Promise<Options> {
  return new Promise(resolve =>
    chrome.storage.sync.get("options", result =>
      resolve(result.options || initialOptions)
    )
  );
}

export async function getStoredOption(
  key: "ext" | "videoQualityMode" | "videoQuality" | "isRemoveNativeDownload"
): Promise<unknown> {
  return new Promise(resolve =>
    chrome.storage.sync.get("options", result =>
      resolve(result.options?.[key] ?? initialOptions[key])
    )
  );
}

export async function setOption(key: string, value: unknown): Promise<void> {
  const options = (await getStoredOptions()) ?? initialOptions;
  options[key] = value;
  return new Promise(resolve => chrome.storage.sync.set({ options }, resolve));
}
