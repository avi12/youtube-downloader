import { checkInterruptedDownload } from "../download/interrupted-downloads";
import { handleStreamData, handleStreamError } from "../download/stream-transfer";
import { handlePageChange } from "../ui/page-router";
import { mountPanelUi } from "../ui/panel-ui";
import { registerDownloadProgressHandlers } from "./cross-world-download";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { forwardSabrCredentialsWithRetry } from "@/lib/youtube/sabr/credentials";
import { videoDataSchema } from "@/lib/youtube/schemas";

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

    forwardSabrCredentialsWithRetry().catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.PanelContentReady, ({ data }) => {
    const parsed = videoDataSchema.safeParse(JSON.parse(data.videoDataJson));
    if (!parsed.success) {
      return;
    }

    mountPanelUi({
      context,
      contentId: data.contentId,
      videoData: parsed.data
    });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StreamData, ({ data }) => {
    handleStreamData(data).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StreamError, ({ data }) => {
    handleStreamError(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadViaIframe, ({ data }) => {
    sendMessage(MessageType.DownloadViaWatchPage, data).catch(() => {});
  });

  crossWorldMessenger.onMessage(
    CrossWorldMessage.ProxyFetch,
    ({ data }) => sendMessage(MessageType.BackgroundProxyFetch, data)
  );

  registerDownloadProgressHandlers();
}
