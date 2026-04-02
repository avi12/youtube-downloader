/**
 * Download handler for the isolated world.
 *
 * Broadcasts a direct-download-request to the MAIN world, which calls
 * the innertube /player API with the android_vr client to get direct
 * download URLs (no SABR, no PO token, no n-parameter decryption).
 * Works on all page types (watch, channel, home, etc).
 */

import { downloadProgressStore } from "@/lib/synced-stores.svelte";
import type { DownloadRequest } from "@/types";

export function listenForDownloadRequests() {
  addEventListener("message", e => {
    if (e.data?.namespace !== "ytdl-sync" || e.data.key !== "download-request") {
      return;
    }

    const request: DownloadRequest | null = e.data.value;
    if (!request?.videoId) {
      return;
    }

    // Broadcast to MAIN world for direct URL download
    postMessage({
      namespace: "ytdl-sync",
      key: "direct-download-request",
      value: {
        videoId: request.videoId,
        videoItag: request.videoItag,
        audioItag: request.audioItag,
        filenameOutput: request.filenameOutput,
        type: request.type
      }
    }, "*");
  });
}
