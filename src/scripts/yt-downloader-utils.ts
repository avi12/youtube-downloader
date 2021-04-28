import type { VideoData } from "./types";

export async function getElementByObserver(
  selector: string
): Promise<HTMLElement> {
  return new Promise(resolve => {
    const observerHtml = new MutationObserver((_, observer) => {
      const element = document.querySelector(selector);
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

export function getVideoId(url: string): string {
  if (url.includes("/embed/")) {
    return url.split("/").pop();
  }
  const urlParams = new URLSearchParams(new URL(url).search);
  return urlParams.get("v");
}

export function parseText(query) {
  try {
    return JSON.parse(query);
  } catch {
    if (!isNaN(query)) {
      return Number(query);
    }

    if (typeof query !== "string") {
      const obj = {};
      for (const queryKey in query) {
        if (query.hasOwnProperty(queryKey)) {
          obj[queryKey] = parseText(query[queryKey]);
        }
      }

      return obj;
    }
    if (!query) {
      return "";
    }

    if (query.toLowerCase().match(/^(true|false)$/)) {
      return query.toLowerCase() === "true";
    }

    const object = Object.fromEntries(new URLSearchParams(query));
    const values = Object.values(object);
    if (values.length === 1 && values[0] === "") {
      return query;
    }
    return parseText(object);
  }
}

export async function getVideoInfo(id: string): Promise<VideoData> {
  const port = chrome.runtime.connect({ name: "get-video-info" });
  port.postMessage(id);
  return new Promise(resolve => port.onMessage.addListener(resolve));
}
