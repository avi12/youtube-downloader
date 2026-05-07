// Hosts iframes inside the Chrome offscreen document (or Firefox processor tab)
// on behalf of the SW. Chrome MV3 background workers have no DOM, so the
// orchestrator delegates iframe creation here via offscreen-messaging port.
// Position offscreen, NOT visibility:hidden - browsers pause media activity
// in visibility:hidden frames.
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
  // Browsers block autoplay in hidden iframes by default. The allow attribute
  // explicitly opts the iframe in so player.playVideo() inside the iframe can
  // start media segment fetches.
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

interface ScrubSegmentMessage {
  type: typeof IframeHostMessageType.ScrubSegment;
  videoId: string;
  iScrub: number;
  videoBuffer: ArrayBuffer;
  audioBuffer: ArrayBuffer;
  videoMimeType: string;
  audioMimeType: string;
  videoBufferStartSec?: number;
  videoBufferEndSec?: number;
}

function isScrubSegmentMessage(data: unknown): data is ScrubSegmentMessage {
  return typeof data === "object" && data !== null &&
    "type" in data && data.type === IframeHostMessageType.ScrubSegment;
}

// Relays postMessage events from hosted iframes to the background service worker.
// Firefox doesn't inject isolated content scripts into moz-extension:// hosted
// iframes, so the MAIN-world script uses parent.postMessage as the only relay path.
export function initIframeMessageRelay() {
  addEventListener("message", e => {
    if (typeof e.data === "object" && e.data !== null && e.data.type === IframeHostMessageType.ScrubDebug) {
      void sendMessage(MessageType.BgDebugLog, { msg: String(e.data.msg) });
      return;
    }

    if (isScrubSegmentMessage(e.data)) {
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
      return;
    }

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
