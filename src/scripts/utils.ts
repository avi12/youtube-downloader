import type { MusicQueue, VideoQueue } from "./types";

export async function updateVideoQueue(videoQueue: VideoQueue): Promise<void> {
  await setLocalStorage("videoQueue", videoQueue);
}

export async function updateMusicQueue(musicQueue: MusicQueue): Promise<void> {
  await setLocalStorage("musicQueue", musicQueue);
}

export async function setLocalStorage(
  key:
    | "videoQueue"
    | "musicQueue"
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

export async function getLocalStorage(
  key:
    | "videoQueue"
    | "musicQueue"
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

async function getElementByObserver(selector: string): Promise<HTMLElement> {
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

export function isElementVisible(element: HTMLElement | Element): boolean {
  return (
    (<HTMLElement>element).offsetWidth > 0 &&
    (<HTMLElement>element).offsetHeight > 0
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

export async function getElementEventually(selector: string): Promise<Element> {
  const elements = document.querySelectorAll(selector);
  return (
    (elements.length > 0 && getVisibleElementInArray(elements)) ||
    (await getElementByObserver(selector))
  );
}

export function getVideoId(url: string): string | null {
  const urlParams = new URLSearchParams(new URL(url).search);
  return urlParams.get("v");
}

// eslint-disable-next-line @typescript-eslint/ban-types
export function hasOwnProperty(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export const gExtToMime = {
  aac: "audio/aac",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  oga: "audio/ogg",
  ogv: "video/ogg",
  opus: "audio/opus",
  ts: "video/mp2t",
  wav: "audio/wav",
  weba: "audio/webm",
  webm: "video/webm",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp2"
};

export function getMimeType(filename: string): string | undefined {
  const ext = filename.split(".").pop();
  return gExtToMime[ext];
}
