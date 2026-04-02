/**
 * Download handler for the isolated world.
 *
 * On watch pages: broadcasts a "start-direct-download" message to the
 * MAIN world, which fetches video/audio using the android_vr client
 * URLs (YouTube's Service Worker handles CORS). The MAIN world then
 * dispatches the data via the existing ytdl:stream-data event.
 *
 * On non-watch pages: opens the video's watch page in a new tab.
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

    if (location.pathname === "/watch") {
      // Tell the MAIN world to handle the download using direct URLs
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
    } else {
      open(`https://www.youtube.com/watch?v=${request.videoId}`, "_blank");
      downloadProgressStore.delete(request.videoId);
    }
  });
}
