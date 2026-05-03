import { downloadViaSabr } from "./sabr-downloader";
import type { DownloadRequest } from "@/types";

const SABR_STALL_TIMEOUT_MS = 30_000;
const MAX_STALL_RETRIES = 3;

export async function attemptSabrDownload({ request, signal, tabId }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
}) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_STALL_RETRIES; attempt++) {
    if (signal.aborted) {
      throw lastError;
    }

    const sabrAbortController = new AbortController();
    function onCancel() {
      sabrAbortController.abort();
    }
    signal.addEventListener("abort", onCancel, { once: true });

    let sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);

    try {
      return await downloadViaSabr({
        request,
        signal: sabrAbortController.signal,
        tabId,
        onProgress() {
          clearTimeout(sabrStallTimeoutId);
          sabrStallTimeoutId = setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
        }
      });
    } catch (error) {
      lastError = error;

      if (signal.aborted) {
        throw error;
      }
    } finally {
      clearTimeout(sabrStallTimeoutId);
      signal.removeEventListener("abort", onCancel);
    }
  }

  throw lastError;
}
