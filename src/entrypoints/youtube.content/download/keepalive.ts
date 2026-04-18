import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";

const CHROME_SW_IDLE_KILL_MS = 30_000;
const SW_KEEPALIVE_INTERVAL_MS = CHROME_SW_IDLE_KILL_MS - 5_000;

export function listenForKeepalive() {
  onMessage(MessageType.StartKeepalive, () => {
    const keepaliveInterval = setInterval(async () => {
      try {
        await sendMessage(MessageType.Keepalive, {});
      } catch {
        clearInterval(keepaliveInterval);
      }
    }, SW_KEEPALIVE_INTERVAL_MS);

    addEventListener("beforeunload", () => {
      clearInterval(keepaliveInterval);
    });
  });
}
