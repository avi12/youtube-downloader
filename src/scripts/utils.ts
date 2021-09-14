import type { MusicQueue, VideoOnlyQueue, VideoQueue } from "./types";

export async function updateQueue(
  queueType: "video" | "videoOnly" | "music",
  queue: VideoQueue | MusicQueue | VideoOnlyQueue
): Promise<void> {
  await setLocalStorage(`${queueType}Queue`, queue);
}

export async function setLocalStorage(
  key:
    | "videoQueue"
    | "videoOnlyQueue"
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
    | "videoOnlyQueue"
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

async function getElementsByObserver(selector: string): Promise<HTMLElement[]> {
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
    (await getElementByObserver(selector))
  );
}

export async function getElementsEventually(
  selector: string
): Promise<Element[]> {
  const elements = document.querySelectorAll(selector);
  return (
    (elements.length > 0 && getVisibleElementsInArray(elements)) ||
    (await getElementsByObserver(selector))
  );
}

export function getVideoId(url: string): string | null {
  const urlParams = new URLSearchParams(new URL(url).search);
  return urlParams.get("v");
}

export function isElementInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 && rect.bottom + 50 <= document.documentElement.clientHeight
  );
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
  "3g2": "video/3gpp2"
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

export function getFileExt(filename: string): string {
  return filename.split(".").pop();
}

export function getMimeType(filename: string): string | undefined {
  return gExtToMimeAll[getFileExt(filename)];
}
