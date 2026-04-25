// Hosts iframes inside the Chrome offscreen document on behalf of the SW.
// Chrome MV3 background workers have no DOM, so the orchestrator delegates
// iframe creation here via offscreen-messaging port.
const HIDDEN_IFRAME_STYLE = "position:fixed;left:-99999px;top:-99999px;width:480px;height:270px;border:0;visibility:hidden";

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
