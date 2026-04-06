import { uncancelStreamTransfer } from "./stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging";

export function listenForDownloadRequests() {
  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    uncancelStreamTransfer(data.videoId);
    sendMessage(MessageType.DirectDownload, {
      videoId: data.videoId,
      videoItag: data.videoItag,
      audioItag: data.audioItag,
      filenameOutput: data.filenameOutput,
      type: data.type
    }).catch(error => {
      console.error("[ytdl] Download failed:", error);
    });
  });
}
