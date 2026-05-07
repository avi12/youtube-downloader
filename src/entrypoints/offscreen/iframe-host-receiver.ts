import { IframeHostMessageType } from "@/lib/messaging/iframe-host-postmessage";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";

interface TemplateReadyMessage {
  type: typeof IframeHostMessageType.TemplateReady;
  factoryId: string;
  videoId: string;
  url: string;
  bodyBase64: string;
  capturedAt: number;
}

function isTemplateReadyMessage(data: unknown): data is TemplateReadyMessage {
  if (typeof data !== "object" || data === null || !("type" in data)) {
    return false;
  }

  return data.type === IframeHostMessageType.TemplateReady;
}

const HIDDEN_IFRAME_STYLE = "position:fixed;left:-99999px;top:-99999px;width:480px;height:270px;border:0";

const iframesById = new Map<string, HTMLIFrameElement>();

export function spawnIframe({ id, url }: {
  id: string;
  url: string;
}) {
  if (iframesById.has(id)) {
    return;
  }

  const elFrame = document.createElement("iframe");
  elFrame.dataset.ytdlIframeHost = id;
  elFrame.src = url;
  elFrame.setAttribute("allow", "autoplay; encrypted-media; clipboard-read");
  elFrame.setAttribute("style", HIDDEN_IFRAME_STYLE);
  document.body.append(elFrame);
  iframesById.set(id, elFrame);
}

export function removeIframe({ id }: {
  id: string;
}) {
  const elFrame = iframesById.get(id);
  if (!elFrame) {
    return;
  }

  elFrame.remove();
  iframesById.delete(id);
}

export function forwardToIframe({ iframeId, payload }: {
  iframeId: string;
  payload: unknown;
}) {
  iframesById.get(iframeId)?.contentWindow?.postMessage(
    {
      ytdlType: IframeHostMessageType.ExecuteDownload,
      request: payload
    },
    "https://www.youtube.com"
  );
}

export function initIframeMessageRelay() {
  addEventListener("message", e => {
    if (!isTemplateReadyMessage(e.data)) {
      return;
    }

    void sendMessage(MessageType.SabrTemplateReady, {
      videoId: e.data.videoId,
      factoryId: e.data.factoryId,
      url: e.data.url,
      bodyBase64: e.data.bodyBase64,
      capturedAt: e.data.capturedAt
    });
  });
}
