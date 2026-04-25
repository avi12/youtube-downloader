// Hosts hidden iframes inside the extension's background page (Firefox: the BG
// script's own document; Chrome MV3: the offscreen document, since the SW has
// no DOM). Replaces `browser.tabs.create` for scrub/factory iframes so the
// extension never opens a visible tab or popup window for media capture.
import { ensureProcessor } from "../handlers/processor";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";

const HIDDEN_IFRAME_STYLE = "position:fixed;left:-99999px;top:-99999px;width:480px;height:270px;border:0;visibility:hidden";

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
