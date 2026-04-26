// Hosts hidden iframes inside the extension's background page (Firefox: the
// BG script's own document; Chrome MV3: the offscreen document, since the SW
// has no DOM). Replaces `browser.tabs.create` for scrub/factory iframes so
// the extension never opens a visible tab or popup window for media capture.
import { ensureProcessor } from "../handlers/processor";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";

async function broadcastDiagToTabs(msg: string) {
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

function appendLocalIframe({ id, url }: {
  id: string;
  url: string;
}) {
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
  const total = document.querySelectorAll("iframe[data-ytdl-iframe-host]").length;
  void broadcastDiagToTabs(`[ytdl:iframe-host] appended id=${id} bodyChildren=${document.body.children.length} hostedIframes=${total} attached=${document.body.contains(elFrame)}`);

  elFrame.addEventListener("load", () => {
    let contentLoc = "blocked-cross-origin";
    try {
      contentLoc = elFrame.contentWindow?.location.href ?? "n/a";
    } catch {
      // expected for cross-origin iframes
    }

    void broadcastDiagToTabs(`[ytdl:iframe-host] load fired id=${id} contentDocument=${elFrame.contentDocument ? "yes" : "no"} contentLoc=${contentLoc}`);
  });

  elFrame.addEventListener("error", () => {
    void broadcastDiagToTabs(`[ytdl:iframe-host] error event id=${id}`);
  });

  setTimeout(() => {
    let contentLoc = "blocked-cross-origin";
    let contentBodyTagCount = -1;
    let titleProp = "n/a";
    try {
      contentLoc = elFrame.contentWindow?.location.href ?? "n/a";
    } catch {
      // expected
    }

    try {
      contentBodyTagCount = elFrame.contentDocument?.body?.children?.length ?? -1;
    } catch {
      // expected for cross-origin
    }

    try {
      titleProp = elFrame.contentDocument?.title ?? "n/a";
    } catch {
      // expected
    }

    void broadcastDiagToTabs(`[ytdl:iframe-host] +5s id=${id} stillAttached=${document.body.contains(elFrame)} contentLoc=${contentLoc} contentBodyChildren=${contentBodyTagCount} title=${titleProp}`);
  }, 5000);
}

function removeLocalIframe(id: string) {
  const elFrame = localIframes.get(id);
  if (!elFrame) {
    return;
  }

  elFrame.remove();
  localIframes.delete(id);
}

export async function spawnHostedIframe({ id, url }: {
  id: string;
  url: string;
}) {
  if (import.meta.env.FIREFOX) {
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
    removeLocalIframe(id);
    return;
  }

  sendToOffscreen(OffscreenMessageType.RemoveIframe, { id });
}
