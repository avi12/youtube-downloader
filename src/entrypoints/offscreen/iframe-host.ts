import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

const downloadIframes = new Map<string, HTMLIFrameElement>();

function silenceIframeAudio(elIframe: HTMLIFrameElement) {
  const { contentDocument } = elIframe;
  if (!contentDocument) {
    return;
  }

  function applyToVideo(elVideo: HTMLVideoElement) {
    Object.defineProperty(elVideo, "muted", {
      get() {
        return true;
      },
      set() {},
      configurable: true
    });
    Object.defineProperty(elVideo, "volume", {
      get() {
        return 0;
      },
      set() {},
      configurable: true
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
