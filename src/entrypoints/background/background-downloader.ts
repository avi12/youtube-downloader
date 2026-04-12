import { ensureProcessor } from "./processor";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/offscreen-messaging";
import type { DownloadRequest } from "@/types";

// The actual fetch + mux + save runs in the offscreen document (Chrome) /
// hidden processor tab (Firefox). Keeping those bytes off the service
// worker's main thread avoids saturating Chrome's extension IPC broker on
// large files — on 1.5 GB downloads this meant ~60 s of UI unresponsiveness
// on the YouTube tab. Now the SW is a pure coordinator.
//
// Cancellation: forwarded to the offscreen context, where the actual
// AbortController lives.

export async function startBackgroundDownload(request: DownloadRequest, tabId: number) {
  await ensureProcessor();
  sendToOffscreen(OffscreenMessageType.StartOffscreenDownload, { request, tabId });
}

export function cancelBackgroundDownload(videoId: string) {
  sendToOffscreen(OffscreenMessageType.CancelOffscreenDownload, { videoId });
}
