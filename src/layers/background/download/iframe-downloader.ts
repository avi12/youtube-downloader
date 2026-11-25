import { ensureProcessor } from "@/layers/background/handlers/processor";
import { enqueueToPopupList } from "@/layers/background/queue/popup-list";
import { awaitVideoComplete } from "@/layers/background/queue/sequential-queue";
import { trackVideoForTab } from "@/layers/background/queue/tab-tracker";
import { handleTerminalFailure } from "./background-downloader";
import { MessageType, onMessage, sendMessageToTab } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { optionsItem } from "@/lib/storage/storage";
import { createLogger, LogScope } from "@/lib/utils/logger";
import { resolveDownloadType } from "@/lib/youtube/download-type";
import { WATCH_PAGE_URL } from "@/lib/youtube/youtube-url";
import type { DownloadRequest, Prettify } from "@/types";
import { awaitFrameSession } from "#background/lib/youtube/sabr/player-session";

const log = createLogger(LogScope.Background);

const IFRAME_READY_TIMEOUT_MS = 60_000;
const NO_CONTENT_SCRIPT_TAB_ID = -1;

const pendingIframeReady = new Map<string, {
  resolve: () => void;
  request: DownloadRequest;
}>();

export function initIframeReadyListener() {
  onMessage(MessageType.AwaitPlayerSession, async ({ data }) => {
    await awaitFrameSession(data.videoId);
  });

  onMessage(MessageType.DownloadIframeReady, ({ data }) => {
    const pending = pendingIframeReady.get(data.videoId);
    if (!pending) {
      return null;
    }

    pending.resolve();
    pendingIframeReady.delete(data.videoId);
    return pending.request;
  });
}

// One hidden-frame attempt per video: a leftover one would time out later and fail its successor
const attemptsByVideo = new Map<string, AbortController>();

async function prepareIframe({ data, signal }: {
  data: DownloadRequest;
  signal: AbortSignal;
}) {
  await ensureProcessor();

  // Mobile user agents get redirected to m.youtube.com, where no content script runs
  const watchParams = new URLSearchParams({
    v: data.videoId,
    ytdl: "1",
    mute: "1",
    autoplay: "1",
    app: "desktop"
  });
  const watchUrl = `${WATCH_PAGE_URL}?${watchParams.toString()}`;

  sendToOffscreen({
    type: OffscreenMessageType.CreateDownloadIframe,
    data: {
      videoId: data.videoId,
      watchUrl
    }
  });

  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingIframeReady.delete(data.videoId);
      reject(new Error(`Iframe ready timeout: ${data.videoId}`));
    }, IFRAME_READY_TIMEOUT_MS);

    signal.addEventListener("abort", () => {
      clearTimeout(timeoutId);
      pendingIframeReady.delete(data.videoId);
      reject(signal.reason);
    }, { once: true });

    pendingIframeReady.set(data.videoId, {
      resolve() {
        clearTimeout(timeoutId);
        resolve();
      },
      request: data
    });
  });
}

type DownloadViaWatchPageParams = Prettify<{
  data: DownloadRequest;
  tabId: number;
}>;
export async function downloadViaWatchPage({ data, tabId }: DownloadViaWatchPageParams) {
  attemptsByVideo.get(data.videoId)?.abort();
  const attempt = new AbortController();
  attemptsByVideo.set(data.videoId, attempt);

  await enqueueToPopupList({
    videoId: data.videoId,
    type: data.type,
    filenameOutput: data.filenameOutput,
    tabId,
    sourceUrl: data.sourceUrl,
    title: data.metadata?.title,
    channel: data.metadata?.artist,
    thumbnailUrl: data.metadata?.thumbnailUrl,
    lengthSeconds: data.metadata?.lengthSeconds
  });
  trackVideoForTab({
    videoId: data.videoId,
    tabId
  });

  try {
    await prepareIframe({
      data: {
        ...data,
        isIframeFallback: true,
        originTabId: tabId
      },
      signal: attempt.signal
    });

    await sendMessageToTab({
       type: MessageType.StartKeepalive,
       data: {
       videoId: data.videoId 
    },
       tabId 
    });

    await awaitVideoComplete({
      videoId: data.videoId,
      signal: attempt.signal
    });
    sendToOffscreen({
      type: OffscreenMessageType.RemoveDownloadIframe,
      data: {
        videoId: data.videoId
      }
    });
  } catch (error) {
    if (attempt.signal.aborted) {
      return;
    }

    log.error("DownloadViaWatchPage failed:", data.videoId, error);
    pendingIframeReady.delete(data.videoId);
    sendToOffscreen({
      type: OffscreenMessageType.RemoveDownloadIframe,
      data: {
        videoId: data.videoId
      }
    });
    await handleTerminalFailure({
      videoId: data.videoId,
      tabId
    });
  }
}

type PopupDownloadData = Prettify<Pick<DownloadRequest, "videoId" | "sourceUrl">>;
async function buildDefaultPopupRequest(data: PopupDownloadData) {
  const { defaultDownloadType } = await optionsItem.getValue();
  return {
    ...data,
    type: resolveDownloadType({
      preference: defaultDownloadType,
      isMusic: false
    }),
    videoItag: 0,
    audioItag: 0,
    filenameOutput: data.videoId,
    isDefaultFormat: true
  };
}

// The tab has no content script, so progress goes only to the popup. The popup's options panel picks
// the formats; its plain Download button leaves them to the iframe
export function registerPopupDownloadHandler() {
  onMessage(MessageType.StartPopupDownload, async ({ data: { request, ...data } }) => {
    downloadViaWatchPage({
      data: request
        ? {
          ...request,
          sourceUrl: data.sourceUrl
        }
        : await buildDefaultPopupRequest(data),
      tabId: NO_CONTENT_SCRIPT_TAB_ID
    }).catch(() => {});
  });
}
