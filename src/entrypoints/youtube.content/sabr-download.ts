import { uncancelStreamTransfer } from "./stream-transfer";
import { MessageType, sendMessage } from "@/lib/messaging";
import { SYNC_NAMESPACE, SyncKey } from "@/lib/synced-stores.svelte";
import type { DownloadRequest } from "@/types";

export function listenForDownloadRequests() {
  addEventListener("message", e => {
    if (e.data?.namespace !== SYNC_NAMESPACE || e.data.key !== SyncKey.DownloadRequest) {
      return;
    }

    const request: DownloadRequest | null = e.data.value;
    if (!request?.videoId) {
      return;
    }

    uncancelStreamTransfer(request.videoId);
    void sendMessage(MessageType.DirectDownload, {
      videoId: request.videoId,
      videoItag: request.videoItag,
      audioItag: request.audioItag,
      filenameOutput: request.filenameOutput,
      type: request.type
    });
  });
}
