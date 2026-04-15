import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";

// 25s keeps the SW alive; Chrome kills idle SWs after ~30s
const swKeepaliveIntervalMs = 25_000;

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
