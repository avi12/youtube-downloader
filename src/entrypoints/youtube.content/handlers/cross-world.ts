import { checkInterruptedDownload } from "../download/interrupted-downloads";
import { handleStreamData, handleStreamError } from "../download/stream-transfer";
import { handlePageChange } from "../ui/page-router";
import { mountPanelUi } from "../ui/panel-ui";
import { registerDownloadProgressHandlers } from "./cross-world-download";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { forwardSabrCredentialsWithRetry } from "@/lib/youtube/sabr/credentials";
import type { VideoData } from "@/types";

type RegisterCrossWorldHandlersParams = {
  isDownloadIframe: boolean;
  context: InstanceType<typeof ContentScriptContext>;
};
export function registerCrossWorldHandlers({ isDownloadIframe, context }: RegisterCrossWorldHandlersParams) {
  crossWorldMessenger.onMessage(CrossWorldMessage.VideoData, async ({ data }) => {
    await checkInterruptedDownload(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.Navigation, ({ data }) => {
    const isMainFrame = !isDownloadIframe;
    if (isMainFrame) {
      handlePageChange({
        url: data.url,
        context
      });
    }

    void forwardSabrCredentialsWithRetry();
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.PanelContentReady, ({ data }) => {
    const videoData: VideoData = JSON.parse(data.videoDataJson);
    mountPanelUi({
      context,
      contentId: data.contentId,
      videoData
    });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StreamData, ({ data }) => {
    void handleStreamData(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StreamError, ({ data }) => {
    handleStreamError(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadViaIframe, ({ data }) => {
    void sendMessage(MessageType.DownloadViaWatchPage, data);
  });

  crossWorldMessenger.onMessage(
    CrossWorldMessage.ProxyFetch,
    ({ data }) => sendMessage(MessageType.BackgroundProxyFetch, data)
  );

  registerDownloadProgressHandlers();
}
