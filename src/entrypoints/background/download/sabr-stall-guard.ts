import { downloadViaSabr } from "./sabr-downloader";
import type { DownloadRequest } from "@/types";

const SABR_STALL_TIMEOUT_MS = 30_000;

export async function attemptSabrDownload({ request, signal, tabId }: {
  request: DownloadRequest;
  signal: AbortSignal;
  tabId: number;
}) {
  const sabrAbortController = new AbortController();
  function scheduleStallAbort() {
    return setTimeout(() => sabrAbortController.abort(), SABR_STALL_TIMEOUT_MS);
  }

  let sabrStallTimeoutId = scheduleStallAbort();
  signal.addEventListener("abort", () => sabrAbortController.abort(), { once: true });

  function resetSabrStallTimer() {
    clearTimeout(sabrStallTimeoutId);
    sabrStallTimeoutId = scheduleStallAbort();
  }

  try {
    return await downloadViaSabr({
      request,
      signal: sabrAbortController.signal,
      tabId,
      onProgress: resetSabrStallTimer
    });
  } finally {
    clearTimeout(sabrStallTimeoutId);
  }
}
