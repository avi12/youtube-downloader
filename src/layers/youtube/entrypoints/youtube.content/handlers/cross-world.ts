import { checkInterruptedDownload } from "@/layers/youtube/entrypoints/youtube.content/download/interrupted-downloads";
import { handleStreamData, handleStreamError } from "@/layers/youtube/entrypoints/youtube.content/download/stream-transfer";
import { handlePageChange } from "@/layers/youtube/entrypoints/youtube.content/ui/page-router";
import { mountPanelUi } from "@/layers/youtube/entrypoints/youtube.content/ui/panel-ui";
import { registerDownloadProgressHandlers } from "./cross-world-download";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { CONTENT_OPTIONS } from "@/lib/ui/synced-stores.svelte";
import { isDownloadRequest, isVideoData } from "@/lib/youtube/schemas";
import {
  isNavigationPayload,
  isPanelContentPayload,
  isProxyFetchRequest,
  isStreamDataPayload,
  isStreamErrorPayload,
  isVideoIdPayload
} from "#youtube/lib/messaging/payload-guards";
import { forwardSabrCredentialsWithRetry } from "#youtube/lib/youtube/sabr/credentials";

interface RegisterCrossWorldHandlersParams {
  isDownloadIframe: boolean;
  context: InstanceType<typeof ContentScriptContext>;
}
export function registerCrossWorldHandlers({ isDownloadIframe, context }: RegisterCrossWorldHandlersParams) {
  crossWorldMessenger.onMessage(CrossWorldMessage.VideoData, async ({ data }) => {
    if (!isVideoIdPayload(data)) {
      return;
    }

    await checkInterruptedDownload(data.videoId);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.Navigation, ({ data }) => {
    if (!isNavigationPayload(data)) {
      return;
    }

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
    if (!isPanelContentPayload(data)) {
      return;
    }

    const videoData: unknown = JSON.parse(data.videoDataJson);
    if (!isVideoData(videoData)) {
      return;
    }

    mountPanelUi({
      context,
      contentId: data.contentId,
      videoData
    });
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StreamData, ({ data }) => {
    if (!isStreamDataPayload(data)) {
      return;
    }

    handleStreamData(data).catch(() => {});
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.StreamError, ({ data }) => {
    if (!isStreamErrorPayload(data)) {
      return;
    }

    handleStreamError(data);
  });

  crossWorldMessenger.onMessage(CrossWorldMessage.DownloadViaIframe, ({ data }) => {
    if (!isDownloadRequest(data)) {
      return;
    }

    sendMessage(MessageType.DownloadViaWatchPage, data).catch(() => {});
  });

  crossWorldMessenger.onMessage(
    CrossWorldMessage.ProxyFetch,
    ({ data }) => isProxyFetchRequest(data) ? sendMessage(MessageType.BackgroundProxyFetch, data) : null
  );

  crossWorldMessenger.onMessage(CrossWorldMessage.RequestOptions, () => ({
    ...CONTENT_OPTIONS,
    ext: {
      ...CONTENT_OPTIONS.ext
    }
  }));

  registerDownloadProgressHandlers();
}
