// Hosts iframes inside the Chrome offscreen document on behalf of the SW.
// Chrome MV3 background workers have no DOM, so the orchestrator delegates
// iframe creation here via offscreen-messaging port.
// Position offscreen, NOT visibility:hidden - browsers pause media activity
// in visibility:hidden frames.
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
      ytdlType: "ytdl-execute-download",
      request: payload
    },
    "https://www.youtube.com"
  );
}
