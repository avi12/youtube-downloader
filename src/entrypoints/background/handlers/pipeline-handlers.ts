import { removeHostedIframe } from "../iframe-host/iframe-host";
import { registerRecentDownloadHandlers } from "../recent/recent-download-handler";
import { markVideosCancelled, registerPipelineProgressHandlers } from "./pipeline-progress";
import { signalFFmpegReady } from "./processor";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { isFFmpegReadyItem } from "@/lib/storage/storage";
import { ProgressType } from "@/types";

export { markVideosCancelled };

export function registerPipelineHandlers() {
  registerRecentDownloadHandlers();
  registerPipelineProgressHandlers();

  onMessage(MessageType.ProcessStreamError, ({ data, sender }) => {
    console.error("[ytdl:bg] Stream error for", data.videoId, data.error);
    const tabId = sender.tab?.id;

    void browser.tabs.query({ url: "*://www.youtube.com/*" }).then(tabs => {
      for (const tab of tabs) {
        if (typeof tab.id === "number") {
          void sendMessage(MessageType.BgDebugLog, { msg: `[ytdl:pipeline-error] ${data.videoId}: ${data.error}` }, tab.id);
        }
      }
    });

    if (!tabId) {
      return;
    }

    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: data.videoId,
      progress: 0,
      progressType: ProgressType.Video,
      isRemoved: true
    }, tabId);
    removeHostedIframe(`dl-${data.videoId}`);
  });

  onMessage(MessageType.PipelineFFmpegReady, () => {
    void broadcastDebugLogToYouTubeTabs("[ytdl:bg] PipelineFFmpegReady received - signaling processor ready");
    void isFFmpegReadyItem.setValue(true);
    signalFFmpegReady();
  });

  onMessage(MessageType.PipelineZipProgress, ({ data }) => {
    const { playlistId, isDone, tabId } = data;
    void sendMessage(MessageType.UpdateDownloadProgress, {
      videoId: `zip:${playlistId}`,
      progress: isDone ? 1 : 0,
      progressType: ProgressType.Zip
    }, tabId);
  });
}
