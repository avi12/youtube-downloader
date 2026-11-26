import { isBlob, isHeaders, isRequest } from "@/lib/dom-guards";
import { MessageType, sendMessageToTab } from "@/lib/messaging/messaging";
import { base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";

export type PageProxyFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function inputToUrl(input: RequestInfo | URL) {
  if (isRequest(input)) {
    return input.url;
  }

  return String(input);
}

async function initToBodyBase64({ init, input }: { init: RequestInit | undefined; input: RequestInfo | URL }) {
  const body = init?.body;
  if (body) {
    if (body instanceof ArrayBuffer) {
      return uint8ToBase64(new Uint8Array(body));
    }

    if (ArrayBuffer.isView(body)) {
      return uint8ToBase64(new Uint8Array(body.buffer, body.byteOffset, body.byteLength));
    }

    if (isBlob(body)) {
      return uint8ToBase64(new Uint8Array(await body.arrayBuffer()));
    }

    if (typeof body === "string") {
      return uint8ToBase64(new TextEncoder().encode(body));
    }
  }

  if (isRequest(input)) {
    const cloned = input.clone();
    const buffer = await cloned.arrayBuffer();
    return uint8ToBase64(new Uint8Array(buffer));
  }

  return "";
}

function initHeadersToRecord(init: RequestInit | undefined) {
  const raw = init?.headers;
  if (!raw) {
    return undefined;
  }

  const out: Record<string, string> = {};
  if (isHeaders(raw)) {
    for (const [key, value] of raw) {
      out[key] = value;
    }

    return out;
  }

  if (Array.isArray(raw)) {
    for (const [key, value] of raw) {
      out[key] = value;
    }

    return out;
  }

  return {
    ...raw
  };
}

export function createPageProxyFetch(tabId: number) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = inputToUrl(input);
    const method = (init?.method ?? (isRequest(input) ? input.method : "GET")).toUpperCase();
    const bodyBase64 = await initToBodyBase64({
       init,
       input 
    });
    const headers = initHeadersToRecord(init);

    const result = await sendMessageToTab({
 type: MessageType.PageSabrFetch,
       data: {
      url,
      method,
      bodyBase64,
      ...headers && {
        headers
      }
    },
       tabId 
});
    if (!result) {
      throw new Error("Page SABR fetch returned no response");
    }

    const responseBytes = base64ToUint8Array(result.bodyBase64);
    return new Response(responseBytes, {
      status: result.status,
      headers: result.responseHeaders
    });
  };
}
