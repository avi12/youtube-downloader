/**
 * Download handler for the isolated world.
 *
 * Broadcasts download requests to the MAIN world which handles the
 * actual download using the android_vr client for direct URLs.
 * The MAIN world has proper access to YouTube's session context.
 *
 * If SABR is enabled (future), tries the background service worker
 * first as it has host_permissions for googlevideo.com.
 */

import { MessageType, sendMessage } from "@/lib/messaging";
import { sabrCredentials, SyncKey } from "@/lib/synced-stores.svelte";
import type { DownloadRequest } from "@/types";

async function waitForPoToken(timeoutMs = 10_000) {
  const existing = sabrCredentials.value?.poToken;
  if (existing) {
    return existing;
  }

  return new Promise<string | null>(resolve => {
    let isResolved = false;

    const checkInterval = setInterval(() => {
      const token = sabrCredentials.value?.poToken;
      if (token) {
        isResolved = true;
        clearInterval(checkInterval);
        resolve(token);
      }
    }, 500);

    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        clearInterval(checkInterval);
        resolve(null);
      }
    }, timeoutMs);
  });
}

export function listenForDownloadRequests() {
  addEventListener("message", e => {
    if (e.data?.namespace !== "ytdl-sync" || e.data.key !== SyncKey.DownloadRequest) {
      return;
    }

    const request: DownloadRequest | null = e.data.value;
    if (!request?.videoId) {
      return;
    }

    handleDownload(request);
  });
}

async function handleDownload(request: DownloadRequest) {
  // Strategy 1: Background SabrStream (future-proof)
  // TODO: Re-enable once background SABR + cookie auth is verified
  const isSabrEnabled = false;
  if (isSabrEnabled && request.sabrConfig) {
    const poToken = await waitForPoToken();
    if (poToken) {
      try {
        const isSuccess = await Promise.race([
          sendMessage(MessageType.SabrDownload, { request, poToken }),
          new Promise<false>(resolve => setTimeout(() => resolve(false), 30_000))
        ]);
        if (isSuccess) {
          return;
        }
      } catch {
        // SabrStream failed - fall through
      }
    }
  }

  // Strategy 2: Direct URL download via MAIN world
  // The MAIN world calls the /player API with android_vr client and
  // fetches media directly. It has proper YouTube session context.
  postMessage({
    namespace: "ytdl-sync",
    key: SyncKey.DirectDownloadRequest,
    value: {
      videoId: request.videoId,
      videoItag: request.videoItag,
      audioItag: request.audioItag,
      filenameOutput: request.filenameOutput,
      type: request.type
    }
  }, location.origin);
}
