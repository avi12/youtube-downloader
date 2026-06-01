import { MessageType, sendMessage, sendMessageToTab } from "@/lib/messaging/messaging";
import { mutateStorageItem, statusProgressItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";

// On Chrome MV3, only the background service worker can call
// `browser.tabs.sendMessage`; the offscreen page and download-worker iframe
// inherit the offscreen API restriction and can only use `browser.runtime`.
// On Firefox MV3 every extension context (BG event-page, offscreen iframe,
// nested worker iframe) shares the BG document and has full extension API
// access, so they can all message the tab directly.
//
// Distinguish by runtime: Chrome SW = no document; everything else on
// Firefox = `browser.runtime.getURL("").startsWith("moz-extension://")`.
function canSendToTabDirectly() {
  if (typeof document === "undefined") {
    return true;
  }

  return browser.runtime.getURL("").startsWith("moz-extension://");
}

export { fetchWithProgress } from "./cdn-fetch";

type WriteProgressToStorageParams = {
  videoId: string;
  progress: number;
  progressType: ProgressType;
};
async function writeProgressToStorage({ videoId, progress, progressType }: WriteProgressToStorageParams) {
  const isComplete = progress >= 1 && progressType === ProgressType.FFmpeg;
  await mutateStorageItem({
    item: statusProgressItem,
    mutator(current) {
      current[videoId] = {
        isDownloading: !isComplete,
        isDone: isComplete,
        progress,
        progressType
      };
    }
  });
}

type SendProgressUpdateParams = {
  videoId: string;
  progress: number;
  progressType: ProgressType;
  tabId: number;
};

async function dispatchProgressUpdate({ videoId, progress, progressType, tabId }: SendProgressUpdateParams) {
  // Chrome offscreen documents throw on wxt/storage despite the manifest
  // permission, so we cannot write storage here in that context (see memory
  // `chrome148-offscreen-apis`). Route through the BG SW via
  // ForwardProgressUpdate, which writes storage on the SW side.
  if (!canSendToTabDirectly()) {
    await sendMessage(MessageType.ForwardProgressUpdate, {
      videoId,
      progress,
      progressType,
      tabId
    });
    return;
  }

  // Direct paths (Chrome BG SW, Firefox BG document) have working storage,
  // so write here and skip the BG round-trip.
  await writeProgressToStorage({
    videoId,
    progress,
    progressType
  });

  await sendMessageToTab(MessageType.UpdateDownloadProgress, {
    videoId,
    progress,
    progressType
  }, tabId);
}

const PROGRESS_COALESCE_MS = 100;
const pendingProgressByVideoId = new Map<string, SendProgressUpdateParams>();
const scheduledFlushByVideoId = new Map<string, ReturnType<typeof setTimeout>>();

async function flushPendingProgress(videoId: string) {
  scheduledFlushByVideoId.delete(videoId);
  const pending = pendingProgressByVideoId.get(videoId);
  if (!pending) {
    return;
  }

  pendingProgressByVideoId.delete(videoId);
  await dispatchProgressUpdate(pending);
}

export function sendProgressUpdate(params: SendProgressUpdateParams) {
  pendingProgressByVideoId.set(params.videoId, params);
  const isFlushScheduled = scheduledFlushByVideoId.has(params.videoId);
  if (isFlushScheduled) {
    return;
  }

  const timeoutId = setTimeout(() => {
    void flushPendingProgress(params.videoId);
  }, PROGRESS_COALESCE_MS);
  scheduledFlushByVideoId.set(params.videoId, timeoutId);
}

type CreateProgressFetchParams = {
  signal: AbortSignal;
  onBytesReceived: (bytes: number) => void;
};
export function createProgressFetch({ signal, onBytesReceived }: CreateProgressFetchParams) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, {
      ...init,
      signal,
      credentials: "include"
    });
    if (!response.body) {
      const buffer = await response.arrayBuffer();
      onBytesReceived(buffer.byteLength);
      return new Response(buffer, {
        status: response.status,
        headers: response.headers
      });
    }

    const progressStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        onBytesReceived(chunk.byteLength);
        controller.enqueue(chunk);
      }
    });

    return new Response(response.body.pipeThrough(progressStream), {
      status: response.status,
      headers: response.headers
    });
  };
}
