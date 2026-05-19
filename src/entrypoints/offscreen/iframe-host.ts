import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";
import { browser } from "#imports";

const downloadIframes = new Map<string, HTMLIFrameElement>();
const workerIframes = new Map<string, HTMLIFrameElement>();

function silenceIframeAudio(elIframe: HTMLIFrameElement) {
  const { contentDocument } = elIframe;
  if (!contentDocument) {
    return;
  }

  function lockProperty({ target, prop, value }: {
    target: HTMLVideoElement;
    prop: string;
    value: boolean | number;
  }) {
    Object.defineProperty(target, prop, {
      get: () => value,
      set() {},
      configurable: true
    });
  }

  function applyToVideo(elVideo: HTMLVideoElement) {
    lockProperty({
      target: elVideo,
      prop: "muted",
      value: true
    });
    lockProperty({
      target: elVideo,
      prop: "volume",
      value: 0
    });
  }

  const elVideo = contentDocument.querySelector<HTMLVideoElement>("video");
  if (elVideo) {
    applyToVideo(elVideo);
    return;
  }

  const observer = new MutationObserver(() => {
    const elFound = contentDocument.querySelector<HTMLVideoElement>("video");
    if (elFound) {
      observer.disconnect();
      applyToVideo(elFound);
    }
  });
  observer.observe(contentDocument.documentElement, CHILD_LIST_SUBTREE);
}

export function createDownloadIframe({ videoId, watchUrl }: {
  videoId: string;
  watchUrl: string;
}) {
  const elExisting = downloadIframes.get(videoId);
  if (elExisting) {
    elExisting.remove();
    downloadIframes.delete(videoId);
  }

  const elIframe = document.createElement("iframe");
  elIframe.src = watchUrl;
  elIframe.style.cssText = "position:fixed;inset-block-start:-100px;inset-inline-start:-100px;inline-size:1px;block-size:1px;opacity:0%;pointer-events:none;border:0";
  document.body.append(elIframe);
  elIframe.addEventListener("load", () => silenceIframeAudio(elIframe));
  downloadIframes.set(videoId, elIframe);
}

export function removeDownloadIframe(videoId: string) {
  const elIframe = downloadIframes.get(videoId);
  if (!elIframe) {
    return;
  }

  elIframe.remove();
  downloadIframes.delete(videoId);
}

export function createWorkerIframe(videoId: string): HTMLIFrameElement {
  removeWorkerIframe(videoId);

  const elIframe = document.createElement("iframe");
  elIframe.src = browser.runtime.getURL("/download-worker.html");
  elIframe.style.cssText = "display:none";
  document.body.append(elIframe);
  workerIframes.set(videoId, elIframe);
  return elIframe;
}

export function sendToWorkerIframe(videoId: string, message: unknown) {
  const elIframe = workerIframes.get(videoId);
  elIframe?.contentWindow?.postMessage(message, location.origin);
}

export function removeWorkerIframe(videoId: string) {
  const elIframe = workerIframes.get(videoId);
  if (!elIframe) {
    return;
  }

  elIframe.remove();
  workerIframes.delete(videoId);
}
