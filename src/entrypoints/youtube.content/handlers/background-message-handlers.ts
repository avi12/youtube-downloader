import { setPlaylistContext, uncancelStreamTransfer } from "../download/stream-transfer";
import { CrossWorldMessage, crossWorldMessenger } from "@/lib/messaging/cross-world-messenger";
import { IframeHostMessageType } from "@/lib/messaging/iframe-host-postmessage";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { ScrubUrlParam, YouTubePath } from "@/lib/youtube/youtube-url";

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
  const isTrustFactoryMode = factoryParams.get(ScrubUrlParam.TrustFactoryMode) === "1";
  const factoryVideoId = factoryParams.get("v") ?? "";
  const factoryId = factoryParams.get(ScrubUrlParam.FactoryId) ?? "";
  if (isTrustFactoryMode) {
    void sendMessage(MessageType.BgDebugLog, {
      msg: `[ytdl:factory-isolated] handler registered factoryId=${factoryId} videoId=${factoryVideoId}`
    });
  }

  let isFactoryTemplateSent = false;
  crossWorldMessenger.onMessage(CrossWorldMessage.SabrTemplateCaptured, ({ data }) => {
    cachedSabrTemplate = data;

    if (isTrustFactoryMode) {
      void sendMessage(MessageType.BgDebugLog, {
        msg: `[ytdl:factory-isolated] received SabrTemplateCaptured factoryId=${factoryId} bodyB64Len=${data.bodyBase64.length} sent=${isFactoryTemplateSent}`
      });
    }

    if (isTrustFactoryMode && !isFactoryTemplateSent && factoryVideoId) {
      isFactoryTemplateSent = true;
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

  // eslint-disable-next-line arrow-body-style
  onMessage(MessageType.SynthesizeSabrTemplateFromTab, ({ data }) => {
    return crossWorldMessenger.sendMessage(
      CrossWorldMessage.SynthesizeSabrTemplate,
      { playerTimeMs: data.playerTimeMs }
    ).catch(() => null);
  });

  onMessage(MessageType.RunProgressiveSabrInTab, ({ data }) => {
    void crossWorldMessenger.sendMessage(CrossWorldMessage.RunProgressiveSabr, data);
  });

  onMessage(MessageType.RunCdnFetchInTab, ({ data }) => {
    const hasCdnUrls = Boolean(data.resolvedVideoUrl || data.resolvedAudioUrl);
    if (hasCdnUrls) {
      void crossWorldMessenger.sendMessage(CrossWorldMessage.FetchAndDownloadCdn, data);
      return;
    }

    // No CDN URLs: on Chrome, progressive SABR from the MAIN world is CORS-blocked
    // so route through the isolated sabr-fetch-interceptor CS (host_permissions bypass).
    // On Firefox, RunProgressiveSabr dispatches to the MAIN world handler which has CORS support.
    void crossWorldMessenger.sendMessage(CrossWorldMessage.RunProgressiveSabr, data);
  });

  onMessage(MessageType.ExecuteDownloadItem, ({ data }) => {
    if (location.pathname !== YouTubePath.Watch) {
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

  if (!import.meta.env.FIREFOX || self !== top) {
    return;
  }

  const SCRUB_IFRAME_STYLE = "position:fixed;left:-99999px;top:-99999px;width:480px;height:270px;border:0";
  const scrubIframesById = new Map<string, HTMLIFrameElement>();

  onMessage(MessageType.SpawnScrubIframe, ({ data }) => {
    if (scrubIframesById.has(data.id)) {
      return;
    }

    const elFrame = document.createElement("iframe");
    elFrame.dataset.ytdlScrubHost = data.id;
    elFrame.src = data.url;
    elFrame.setAttribute("allow", "autoplay; encrypted-media; clipboard-read");
    elFrame.setAttribute("style", SCRUB_IFRAME_STYLE);
    document.body.append(elFrame);
    scrubIframesById.set(data.id, elFrame);
  });

  onMessage(MessageType.RemoveScrubIframe, ({ data }) => {
    scrubIframesById.get(data.id)?.remove();
    scrubIframesById.delete(data.id);
  });

  window.addEventListener("message", e => {
    if (e.origin !== "https://www.youtube.com" || typeof e.data !== "object" || !e.data) {
      return;
    }

    if (e.data.type === IframeHostMessageType.ScrubDebug) {
      void sendMessage(MessageType.BgDebugLog, { msg: String(e.data.msg) });
      return;
    }

    if (e.data.type !== IframeHostMessageType.ScrubSegment) {
      return;
    }

    const {
      videoId, iScrub, videoBuffer, audioBuffer,
      videoMimeType, audioMimeType, videoBufferStartSec, videoBufferEndSec
    } = e.data;
    void sendMessage(MessageType.IframeScrubSegmentReady, {
      videoId,
      iScrub,
      videoBytes: new Uint8Array(videoBuffer),
      audioBytes: new Uint8Array(audioBuffer),
      videoMimeType,
      audioMimeType,
      videoBufferStartSec,
      videoBufferEndSec
    });
  });
}
