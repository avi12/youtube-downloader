import type { VideoQueue } from "./types";

export async function updateVideoQueue(videoQueue: VideoQueue): Promise<void> {
  await setStorage("local", "videoQueue", [...videoQueue]);
}

export async function setStorage(
  storageArea: "local" | "sync",
  key:
    | "videoQueue"
    | "tabTracker"
    | "videoDetails"
    | "videoIds"
    | "isFFmpegReady"
    | "statusProgress",
  value: unknown
): Promise<void> {
  return new Promise(resolve =>
    chrome.storage[storageArea].set({ [key]: value }, resolve)
  );
}

export async function getStorage(
  storageArea: "local" | "sync",
  key:
    | "videoQueue"
    | "tabTracker"
    | "videoDetails"
    | "videoIds"
    | "isFFmpegReady"
    | "statusProgress"
): Promise<unknown> {
  return new Promise(resolve =>
    chrome.storage[storageArea].get(key, result =>
      resolve(key ? result[key] : result)
    )
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
