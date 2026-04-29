import { setPlaylistContext, uncancelStreamTransfer } from "../download/stream-transfer";
import {
  CrossWorldMessage,
  CrossWorldSabrMessage,
  crossWorldMessenger,
  crossWorldSabrMessenger
} from "@/lib/messaging/cross-world-messenger";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";

export function registerBackgroundMessageHandlers() {
  onMessage(MessageType.BgDebugLog, ({ data }) => {
    console.log(data.msg);
  });

  let cachedSabrTemplate: {
    url: string;
    bodyBase64: string;
    capturedAt: number;
  } | null = null;

  const factoryParams = new URLSearchParams(location.search);
  const isTrustFactoryMode = factoryParams.get("ytdlTrustFactoryMode") === "1";
  const factoryVideoId = factoryParams.get("v") ?? "";
  const factoryId = factoryParams.get("ytdlFactoryId") ?? "";
  if (isTrustFactoryMode) {
    void sendMessage(MessageType.BgDebugLog, {
      msg: `[ytdl:factory-isolated] handler registered factoryId=${factoryId} videoId=${factoryVideoId}`
    });
  }

  let factoryTemplateSent = false;
  crossWorldMessenger.onMessage(CrossWorldMessage.SabrTemplateCaptured, ({ data }) => {
    cachedSabrTemplate = data;

    if (isTrustFactoryMode) {
      void sendMessage(MessageType.BgDebugLog, {
        msg: `[ytdl:factory-isolated] received SabrTemplateCaptured factoryId=${factoryId} bodyB64Len=${data.bodyBase64.length} sent=${factoryTemplateSent}`
      });
    }

    if (isTrustFactoryMode && !factoryTemplateSent && factoryVideoId) {
      factoryTemplateSent = true;
      void sendMessage(MessageType.SabrTemplateReady, {
        videoId: factoryVideoId,
        factoryId,
        url: data.url,
        bodyBase64: data.bodyBase64,
        capturedAt: data.capturedAt
      });
    }
  });

  onMessage(MessageType.GetSabrTemplateFromTab, async () => {
    if (cachedSabrTemplate) {
      return cachedSabrTemplate;
    }

    const pulled = await crossWorldMessenger.sendMessage(
      CrossWorldMessage.PullSabrTemplate,
      {}
    ).catch(() => null);
    if (pulled) {
      cachedSabrTemplate = pulled;
    }

    return cachedSabrTemplate;
  });

  onMessage(MessageType.SynthesizeSabrTemplateFromTab, ({ data }) => crossWorldSabrMessenger.sendMessage(
    CrossWorldSabrMessage.SynthesizeSabrTemplate,
    { playerTimeMs: data.playerTimeMs }
  ).catch(() => null));

  onMessage(MessageType.RunProgressiveSabrInTab, ({ data }) => {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.RunProgressiveSabr, data);
  });

  onMessage(MessageType.ExecuteDownloadItem, ({ data }) => {
    if (location.pathname !== "/watch") {
      return;
    }

    if (data.playlistId) {
      setPlaylistContext({
        videoId: data.videoId,
        context: {
          playlistId: data.playlistId,
          playlistTitle: data.playlistTitle ?? "Playlist",
          playlistTotalCount: data.playlistTotalCount ?? 1
        }
      });
    }

    uncancelStreamTransfer(data.videoId);
    void crossWorldMessenger.sendMessage(CrossWorldMessage.DownloadRequest, data);
  });
}
