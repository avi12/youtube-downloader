import { ensureProcessor } from "../handlers/processor";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";

const IFRAME_ATTR = "data-ytdl-scrub-iframe";
const IFRAME_DIMS = "width:480px;height:270px;border:0";

function createIframe(id: string, url: string, attr: string, dims: string) {
  if (document.querySelector(`iframe[${attr}="${id}"]`)) {
    return;
  }

  const elFrame = document.createElement("iframe");
  elFrame.setAttribute(attr, id);
  elFrame.src = url;
  elFrame.setAttribute("allow", "autoplay; encrypted-media; clipboard-read");
  elFrame.setAttribute("style", dims);
  document.body.append(elFrame);
}

function removeIframe(id: string, attr: string) {
  document.querySelector(`iframe[${attr}="${id}"]`)?.remove();
}

export async function spawnHostedIframe({
  id,
  url
}: {
  id: string;
  url: string;
}) {
  if (import.meta.env.FIREFOX) {
    createIframe(id, url, IFRAME_ATTR, IFRAME_DIMS);
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
    removeIframe(id, IFRAME_ATTR);
    return;
  }

  sendToOffscreen(OffscreenMessageType.RemoveIframe, { id });
}
