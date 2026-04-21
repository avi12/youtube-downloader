import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { CHILD_LIST_SUBTREE } from "@/lib/utils/dom";

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

export function listenForDownloadIframes(context: InstanceType<typeof ContentScriptContext>) {
  const downloadIframes = new Map<string, HTMLIFrameElement>();

  onMessage(MessageType.CreateDownloadIframe, ({ data }) => {
    const { videoId, watchUrl } = data;

    const elExistingIframe = downloadIframes.get(videoId);
    if (elExistingIframe) {
      elExistingIframe.remove();
      downloadIframes.delete(videoId);
    }

    const elIframe = document.createElement("iframe");
    elIframe.classList.add("ytdl-download-iframe");
    elIframe.src = watchUrl;
    document.body.append(elIframe);
    elIframe.addEventListener("load", () => silenceIframeAudio(elIframe));
    downloadIframes.set(videoId, elIframe);

    context.onInvalidated(() => {
      elIframe.remove();
      downloadIframes.delete(videoId);
    });
  });

  onMessage(MessageType.RemoveDownloadIframe, ({ data }) => {
    const elIframe = downloadIframes.get(data.videoId);
    if (elIframe) {
      elIframe.remove();
      downloadIframes.delete(data.videoId);
    }
  });

  onMessage(MessageType.RefreshDownloadIframe, ({ data }) => {
    const elExisting = downloadIframes.get(data.videoId);
    if (elExisting) {
      elExisting.remove();
      downloadIframes.delete(data.videoId);
    }

    const elIframe = document.createElement("iframe");
    elIframe.classList.add("ytdl-download-iframe");
    elIframe.src = data.watchUrl;
    document.body.append(elIframe);
    elIframe.addEventListener("load", () => silenceIframeAudio(elIframe));
    downloadIframes.set(data.videoId, elIframe);

    context.onInvalidated(() => {
      elIframe.remove();
      downloadIframes.delete(data.videoId);
    });
  });
}
