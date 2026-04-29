import { persistInterruptedDownload } from "./download-retry";
import type { DownloadRequest } from "@/types";

export const pendingNetworkRetries = new Map<string, {
  request: DownloadRequest;
  tabId: number;
}>();

export type RetryCallback = (params: {
  request: DownloadRequest;
  tabId: number;
}) => void;

let retryCallback: RetryCallback | null = null;

export function registerNetworkRetryCallback(callback: RetryCallback) {
  retryCallback = callback;
}

addEventListener("online", () => {
  const retries = [...pendingNetworkRetries.values()];
  pendingNetworkRetries.clear();
  for (const entry of retries) {
    retryCallback?.(entry);
  }
});

export function enqueueNetworkRetry({ request, tabId }: {
  request: DownloadRequest;
  tabId: number;
}) {
  pendingNetworkRetries.set(request.videoId, {
    request,
    tabId
  });
  void persistInterruptedDownload(request);
}
