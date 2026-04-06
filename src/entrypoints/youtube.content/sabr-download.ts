import { uncancelStreamTransfer } from "./stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/cross-world-messenger";

export function listenForDownloadRequests() {
  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadRequest, ({ data }) => {
    uncancelStreamTransfer(data.videoId);
  });
}
