import { MessageType, onMessage } from "@/lib/messaging";

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
}
