import { MessageType, onMessage } from "@/lib/messaging/messaging";
import { base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { createLogger, LogScope } from "@/lib/utils/logger";

const log = createLogger(LogScope.Background);

export function registerProxyFetchHandler() {
  onMessage(MessageType.BackgroundProxyFetch, async ({ data }) => {
    const { url, method, bodyBase64, headers } = data;
    const bodyBytes = base64ToUint8Array(bodyBase64);

    try {
      const response = await fetch(url, {
        method,
        ...bodyBytes.length > 0 && {
          body: bodyBytes
        },
        headers,
        credentials: "include"
      });

      const responseHeaders: Record<string, string> = {};
      for (const [key, value] of response.headers) {
        responseHeaders[key] = value;
      }

      return {
        status: response.status,
        bodyBase64: uint8ToBase64(new Uint8Array(await response.arrayBuffer())),
        responseHeaders
      };
    } catch (fetchError) {
      log.error("BackgroundProxyFetch error:", fetchError);
      return null;
    }
  });
}
