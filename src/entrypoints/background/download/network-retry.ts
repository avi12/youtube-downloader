import { isVideoCancelled } from "../handlers/pipeline-state";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { interruptedDownloadsItem, mutateStorageItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";
import type { DownloadRequest } from "@/types";

const MAX_AUTO_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [5_000, 20_000, 60_000];

export const pendingNetworkRetries = new Map<string, {
  request: DownloadRequest;
  tabId: number;
}>();

const pendingBackoffTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
const autoRetryAttempts = new Map<string, number>();

async function persistInterruptedDownload(request: DownloadRequest) {
  await mutateStorageItem({
    item: interruptedDownloadsItem,
    mutator(current) {
      current[request.videoId] = {
        videoId: request.videoId,
        type: request.type,
        filenameOutput: request.filenameOutput,
        videoItag: request.videoItag,
        audioItag: request.audioItag,
        timestamp: Date.now()
      };
    }
  });
}

export async function clearInterruptedDownload(videoId: string) {
  await mutateStorageItem({
    item: interruptedDownloadsItem,
    mutator(current) {
      delete current[videoId];
    }
  });
}

export async function dropPendingRetry(videoId: string) {
  pendingNetworkRetries.delete(videoId);
  const timeoutId = pendingBackoffTimeouts.get(videoId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    pendingBackoffTimeouts.delete(videoId);
  }

  autoRetryAttempts.delete(videoId);
  await clearInterruptedDownload(videoId);
}

// Conservative classification. A throw is "recoverable" only if the message
// matches a known-transient pattern. Anything else (FFmpeg failure, OPFS error,
// codec parse, attestation wall) falls through to the terminal Retry state.
const RECOVERABLE_PATTERNS = [
  /HTTP\s*5\d\d/i,
  /HTTP\s*429/i,
  /NetworkError/i,
  /Failed to fetch/i,
  /network request failed/i,
  /ECONN/i,
  /ETIMEDOUT/i,
  /timeout/i,
  /chunk fetch failed/i,
  /chunk fetch empty/i,
  /chunk fetch HTTP 5/i,
  /stall/i
];
export function isRecoverableError(error: unknown) {
  const message = error instanceof Error ? `${error.message} ${error.cause ?? ""}` : String(error);
  return RECOVERABLE_PATTERNS.some(pattern => pattern.test(message));
}

type QueueNetworkRetryParams = {
  request: DownloadRequest;
  tabId: number;
};
export async function queueNetworkRetry({ request, tabId }: QueueNetworkRetryParams) {
  pendingNetworkRetries.set(request.videoId, {
    request,
    tabId
  });
  await persistInterruptedDownload(request);
  await sendMessageToTab(MessageType.UpdateDownloadProgress, {
    videoId: request.videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isInterrupted: true
  }, tabId);
}

type StartBackgroundDownloadFn = (params: {
  request: DownloadRequest;
  tabId: number;
}) => Promise<void>;

type ScheduleAutoRetryParams = {
  request: DownloadRequest;
  tabId: number;
  startBackgroundDownload: StartBackgroundDownloadFn;
};
export async function scheduleAutoRetry({ request, tabId, startBackgroundDownload }: ScheduleAutoRetryParams) {
  const { videoId } = request;
  const previousAttempts = autoRetryAttempts.get(videoId) ?? 0;
  const isRetriesExhausted = previousAttempts >= MAX_AUTO_RETRY_ATTEMPTS;
  if (isRetriesExhausted) {
    autoRetryAttempts.delete(videoId);
    return false;
  }

  const delayMs = RETRY_BACKOFF_MS[previousAttempts] ?? RETRY_BACKOFF_MS.at(-1)!;
  autoRetryAttempts.set(videoId, previousAttempts + 1);
  console.warn(
    `[ytdl:bg] Auto-retry ${previousAttempts + 1}/${MAX_AUTO_RETRY_ATTEMPTS} for ${videoId} in ${delayMs}ms`
  );

  const timeoutId = setTimeout(async () => {
    pendingBackoffTimeouts.delete(videoId);
    const isCancelled = isVideoCancelled(videoId);
    if (isCancelled) {
      autoRetryAttempts.delete(videoId);
      return;
    }

    await sendMessageToTab(MessageType.UpdateDownloadProgress, {
      videoId,
      progress: 0,
      progressType: ProgressType.Video
    }, tabId);
    await startBackgroundDownload({
      request,
      tabId
    });
  }, delayMs);
  pendingBackoffTimeouts.set(videoId, timeoutId);

  await sendMessageToTab(MessageType.UpdateDownloadProgress, {
    videoId,
    progress: 0,
    progressType: ProgressType.Video,
    isRemoved: true,
    isInterrupted: true
  }, tabId);
  return true;
}

export function clearAutoRetryCounter(videoId: string) {
  autoRetryAttempts.delete(videoId);
}

export function registerOnlineRetryListener(startBackgroundDownload: StartBackgroundDownloadFn) {
  addEventListener("online", async () => {
    const retries = [...pendingNetworkRetries.values()];
    pendingNetworkRetries.clear();
    for (const { request, tabId } of retries) {
      await sendMessageToTab(MessageType.UpdateDownloadProgress, {
        videoId: request.videoId,
        progress: 0,
        progressType: ProgressType.Video
      }, tabId);
      await startBackgroundDownload({
        request,
        tabId
      });
    }
  });
}
