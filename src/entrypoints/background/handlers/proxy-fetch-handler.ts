import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { uint8ToBase64 } from "@/lib/utils/binary";

export function registerProxyFetchHandler() {
  onMessage(MessageType.BackgroundProxyFetch, async ({ data }) => {
    const { url, method, bodyBase64, headers } = data;

    const bodyBinary = atob(bodyBase64);
    const bodyBytes = new Uint8Array(bodyBinary.length);
    for (let i = 0; i < bodyBinary.length; i++) {
      bodyBytes[i] = bodyBinary.charCodeAt(i);
    }

    try {
      const response = await fetch(url, {
        method,
        body: bodyBytes.length > 0 ? bodyBytes : undefined,
        headers,
        credentials: "include"
      });

      const responseBuffer = await response.arrayBuffer();
      const responseBytes = new Uint8Array(responseBuffer);

      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of response.headers) {
        responseHeaders[key] = value;
      }

      return {
        status: response.status,
        bodyBase64: uint8ToBase64(responseBytes),
        responseHeaders
      };
    } catch (fetchError) {
      console.error("[ytdl] BackgroundProxyFetch error:", fetchError);
      return null;
    }
  });
}
