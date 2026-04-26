// Hosts hidden iframes inside the extension's background page (Firefox: the
// BG script's own document; Chrome MV3: the offscreen document, since the SW
// has no DOM). Replaces `browser.tabs.create` for scrub/factory iframes so
// the extension never opens a visible tab or popup window for media capture.
import { ensureProcessor } from "../handlers/processor";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";

const POST_MESSAGE_TYPE_DEBUG = "ytdl:scrub-debug";
const POST_MESSAGE_TYPE_SEGMENT = "ytdl:scrub-segment";

interface ScrubDebugMessage {
  type: typeof POST_MESSAGE_TYPE_DEBUG;
  msg: string;
}

export interface IframeScrubSegmentPostMessage {
  videoId: string;
  scrubIndex: number;
  videoBytes: Uint8Array;
  audioBytes: Uint8Array;
  videoMimeType: string;
  audioMimeType: string;
}

interface ScrubSegmentMessage {
  type: typeof POST_MESSAGE_TYPE_SEGMENT;
  videoId: string;
  scrubIndex: number;
  videoBuffer: ArrayBuffer;
  audioBuffer: ArrayBuffer;
  videoMimeType: string;
  audioMimeType: string;
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  return Object.assign<Record<string, unknown>, object>({}, data);
}

function isScrubDebugMessage(data: unknown): data is ScrubDebugMessage {
  const record = asRecord(data);
  if (!record) {
    return false;
  }

  return record.type === POST_MESSAGE_TYPE_DEBUG && typeof record.msg === "string";
}

function isScrubSegmentMessage(data: unknown): data is ScrubSegmentMessage {
  const record = asRecord(data);
  if (!record) {
    return false;
  }

  return record.type === POST_MESSAGE_TYPE_SEGMENT
    && typeof record.videoId === "string"
    && typeof record.scrubIndex === "number"
    && record.videoBuffer instanceof ArrayBuffer
    && record.audioBuffer instanceof ArrayBuffer
    && typeof record.videoMimeType === "string"
    && typeof record.audioMimeType === "string";
}

let scrubSegmentHandler: ((segment: IframeScrubSegmentPostMessage) => void) | null = null;

export function setIframeScrubSegmentHandler(
  handler: (segment: IframeScrubSegmentPostMessage) => void
) {
  scrubSegmentHandler = handler;
}

async function broadcastDiagToTabs(msg: string) {
  if (!import.meta.env.DEV) {
    return;
  }

  console.log(msg);
  try {
    const tabs = await browser.tabs.query({ url: "https://www.youtube.com/*" });
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        void sendMessage(MessageType.BgDebugLog, { msg }, tab.id);
      }
    }
  } catch {
    // best-effort
  }
}

// position offscreen rather than visibility:hidden — browsers pause media
// playback (and the SABR fetches that drive it) inside visibility:hidden
// frames, which would prevent the factory iframe from emitting the trust
// template we need to capture.
const HIDDEN_IFRAME_STYLE = "position:fixed;left:-99999px;top:-99999px;width:480px;height:270px;border:0";

const localIframes = new Map<string, HTMLIFrameElement>();

let isPostMessageBridgeInstalled = false;

function ensurePostMessageBridge() {
  if (isPostMessageBridgeInstalled || !import.meta.env.FIREFOX) {
    return;
  }

  isPostMessageBridgeInstalled = true;
  addEventListener("message", e => {
    if (isScrubDebugMessage(e.data)) {
      void broadcastDiagToTabs(e.data.msg);
      return;
    }

    if (isScrubSegmentMessage(e.data)) {
      scrubSegmentHandler?.({
        videoId: e.data.videoId,
        scrubIndex: e.data.scrubIndex,
        videoBytes: new Uint8Array(e.data.videoBuffer),
        audioBytes: new Uint8Array(e.data.audioBuffer),
        videoMimeType: e.data.videoMimeType,
        audioMimeType: e.data.audioMimeType
      });
    }
  });
}

function appendLocalIframe({ id, url }: {
  id: string;
  url: string;
}) {
  ensurePostMessageBridge();

  const elFrame = document.createElement("iframe");
  elFrame.dataset.ytdlIframeHost = id;
  elFrame.src = url;
  // Browsers block autoplay in hidden iframes by default. The allow attribute
  // explicitly opts the iframe in (player.playVideo() can then start media
  // segment fetches inside the BG iframe).
  elFrame.setAttribute("allow", "autoplay; encrypted-media; clipboard-read");
  elFrame.setAttribute("style", HIDDEN_IFRAME_STYLE);
  document.body.append(elFrame);
  localIframes.set(id, elFrame);
}

function removeLocalIframe(id: string) {
  const elFrame = localIframes.get(id);
  if (!elFrame) {
    return;
  }

  elFrame.remove();
  localIframes.delete(id);
}

const tabIdByIframeId = new Map<string, number>();

// Chrome uses the offscreen document. Firefox can't inject content scripts
// into iframes whose top is moz-extension:// (no valid tabId for
// scripting.executeScript), so we mount inside the user's youtube.com tab —
// the iframes are positioned far off-screen (left:-99999px) and never
// painted, so they don't show up in the user's UI even though they're DOM
// children of the watch page.
export async function spawnHostedIframe({ id, url, tabId }: {
  id: string;
  url: string;
  tabId?: number;
}) {
  if (import.meta.env.FIREFOX) {
    if (typeof tabId === "number") {
      tabIdByIframeId.set(id, tabId);
      ensurePostMessageBridge();
      void sendMessage(MessageType.MountScrubIframeInTab, {
        id,
        url
      }, tabId);
      return;
    }

    appendLocalIframe({
      id,
      url
    });
    return;
  }

  await ensureProcessor();
  sendToOffscreen(OffscreenMessageType.SpawnIframe, {
    id,
    url
  });
}

export function removeHostedIframe(id: string) {
  if (import.meta.env.FIREFOX) {
    const tabId = tabIdByIframeId.get(id);
    if (typeof tabId === "number") {
      tabIdByIframeId.delete(id);
      void sendMessage(MessageType.UnmountScrubIframeInTab, { id }, tabId);
      return;
    }

    removeLocalIframe(id);
    return;
  }

  sendToOffscreen(OffscreenMessageType.RemoveIframe, { id });
}
