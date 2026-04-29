import { spawnHostedIframe } from "../iframe-host/iframe-host";
import { MessageType, onMessage } from "@/lib/messaging/messaging";
import type { DownloadRequest } from "@/types";

const DOWNLOAD_IFRAME_ID_PREFIX = "dl-";

function downloadIframeId(videoId: string) {
  return `${DOWNLOAD_IFRAME_ID_PREFIX}${videoId}`;
}

const IFRAME_READY_TIMEOUT_MS = 30_000;

const pendingIframeReady = new Map<string, (tabId: number | undefined, frameId: number) => void>();

export function initIframeReadyListener() {
  onMessage(MessageType.DownloadIframeReady, ({ data, sender }) => {
    pendingIframeReady.get(data.videoId)?.(sender.tab?.id, sender.frameId ?? 0);
    pendingIframeReady.delete(data.videoId);
  });
}

export async function prepareIframe({ data }: {
  data: DownloadRequest;
}): Promise<{
  iframeTabId: number | undefined;
  iframeFrameId: number;
}> {
  const watchParams = new URLSearchParams({
    v: data.videoId,
    ytdl: "1",
    mute: "1"
  });
  const watchUrl = `https://www.youtube.com/watch?${watchParams.toString()}`;

  await spawnHostedIframe({
    id: downloadIframeId(data.videoId),
    url: watchUrl
  });

  let iframeTabId: number | undefined;
  let iframeFrameId = 0;

  await new Promise<void>(resolve => {
    const timeoutId = setTimeout(() => {
      pendingIframeReady.delete(data.videoId);
      resolve();
    }, IFRAME_READY_TIMEOUT_MS);

    pendingIframeReady.set(data.videoId, (tabId, frameId) => {
      iframeTabId = tabId;
      iframeFrameId = frameId;
      clearTimeout(timeoutId);
      resolve();
    });
  });

  return {
    iframeTabId,
    iframeFrameId
  };
}

export function deletePendingIframeReady(videoId: string) {
  pendingIframeReady.delete(videoId);
}
