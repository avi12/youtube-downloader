import { browser } from "#imports";

const downloadIframes = new Map<string, HTMLIFrameElement>();
const workerIframes = new Map<string, HTMLIFrameElement>();

const DOWNLOAD_WORKER_HTML_PATH = "/download-worker.html";
const IFRAME_ALLOW_AUTOPLAY = "autoplay";
const DOWNLOAD_IFRAME_STYLE = "position:fixed;inset-block-start:-100px;inset-inline-start:-100px;inline-size:1px;block-size:1px;opacity:0%;pointer-events:none;border:0";

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
  elIframe.allow = IFRAME_ALLOW_AUTOPLAY;
  elIframe.style.cssText = DOWNLOAD_IFRAME_STYLE;
  document.body.append(elIframe);
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
  elIframe.src = browser.runtime.getURL(DOWNLOAD_WORKER_HTML_PATH);
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
