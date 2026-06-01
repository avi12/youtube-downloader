// Firefox-only: MAIN-world content script that proxies fetches from the background
// event-page through the YouTube tab's page context, so requests carry the same
// cookies and TLS fingerprint as the player's own requests (avoids YouTube's
// anti-bot 403s that hit extension-context fetches).
//
// The fetch is performed via a pristine `about:blank` iframe's `fetch` to bypass
// YouTube's wrapped `window.fetch` (the wrapper throws "fetch called on object
// that does not implement Window" when invoked from injected scripts).
//
// The body is run through `substituteBodyTokens` so the BG can embed
// `__YTDL_VISITOR_DATA__` as a placeholder for ytcfg.VISITOR_DATA, which must be
// read from MAIN-world page context (not available in extension contexts).
import { sabrFetchBridge } from "@/lib/messaging/sabr-fetch-bridge";
import { base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";

const PRISTINE_IFRAME_ATTR = "data-ytdl-pristine-fetch";
const VISITOR_DATA_TOKEN = "__YTDL_VISITOR_DATA__";

declare const ytcfg: {
  get?: (key: string) => unknown;
} | undefined;

function readVisitorData() {
  if (typeof ytcfg === "undefined") {
    return "";
  }

  const value = ytcfg?.get?.("VISITOR_DATA");
  return typeof value === "string" ? value : "";
}

function copyToArrayBuffer(view: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(view);
  return buffer;
}

function substituteBodyTokens(bodyBytes: Uint8Array): ArrayBuffer {
  const text = new TextDecoder().decode(bodyBytes);
  if (!text.includes(VISITOR_DATA_TOKEN)) {
    return copyToArrayBuffer(bodyBytes);
  }

  const visitorData = readVisitorData();
  const replaced = text.replaceAll(VISITOR_DATA_TOKEN, visitorData);
  return copyToArrayBuffer(new TextEncoder().encode(replaced));
}

function getPristineFetch(): typeof fetch {
  const elExisting = document.querySelector<HTMLIFrameElement>(`iframe[${PRISTINE_IFRAME_ATTR}]`);
  if (elExisting?.contentWindow?.fetch) {
    return elExisting.contentWindow.fetch.bind(elExisting.contentWindow);
  }

  const elIframe = document.createElement("iframe");
  elIframe.setAttribute(PRISTINE_IFRAME_ATTR, "");
  elIframe.src = "about:blank";
  elIframe.style.display = "none";
  (document.documentElement ?? document.body).append(elIframe);
  return elIframe.contentWindow!.fetch.bind(elIframe.contentWindow);
}

export default defineContentScript({
  matches: ["https://www.youtube.com/*"],
  allFrames: false,
  world: "MAIN",
  runAt: "document_start",
  main() {
    sabrFetchBridge.onMessage("pageSabrFetch", async ({ data: { url, method, bodyBase64, headers } }) => {
      const rawBodyBytes = bodyBase64 ? base64ToUint8Array(bodyBase64) : null;
      const bodyBuffer = rawBodyBytes ? substituteBodyTokens(rawBodyBytes) : null;

      try {
        const pristineFetch = getPristineFetch();
        const hasBody = bodyBuffer !== null && bodyBuffer.byteLength > 0;
        const fetchInit: RequestInit = {
          method,
          credentials: "include"
        };
        if (headers) {
          fetchInit.headers = headers;
        }

        if (hasBody && bodyBuffer) {
          fetchInit.body = bodyBuffer;
        }

        const response = await pristineFetch(url, fetchInit);

        const responseBuffer = await response.arrayBuffer();
        const responseHeaders: Record<string, string> = {};
        for (const [name, value] of response.headers) {
          responseHeaders[name.toLowerCase()] = value;
        }

        return {
          status: response.status,
          bodyBase64: uint8ToBase64(new Uint8Array(responseBuffer)),
          responseHeaders
        };
      } catch (error) {
        console.error("[ytdl:page-sabr-fetch] error", url, error);
        return null;
      }
    });
  }
});
