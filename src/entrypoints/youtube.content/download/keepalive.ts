import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";

const chromeSwIdleKillMs = 30_000;
const swKeepaliveIntervalMs = chromeSwIdleKillMs - 5_000;

export function listenForKeepalive() {
  onMessage(MessageType.StartKeepalive, () => {
    const keepaliveInterval = setInterval(async () => {
      try {
        await sendMessage(MessageType.Keepalive, {});
      } catch {
        clearInterval(keepaliveInterval);
      }
    }, swKeepaliveIntervalMs);

    addEventListener("beforeunload", () => {
      clearInterval(keepaliveInterval);
    });
  });
}
