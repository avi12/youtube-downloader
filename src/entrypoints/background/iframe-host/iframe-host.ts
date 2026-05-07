import { ensureProcessor } from "../handlers/processor";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";

export async function spawnHostedIframe({ id, url, tabId }: {
  id: string;
  url: string;
  tabId?: number;
}) {
  if (import.meta.env.FIREFOX && tabId !== undefined) {
    void sendMessage(MessageType.SpawnScrubIframe, {
      id,
      url
    }, tabId);
    return;
  }

  await ensureProcessor();
  sendToOffscreen(OffscreenMessageType.SpawnIframe, {
    id,
    url
  });
}

export function removeHostedIframe(id: string, tabId?: number) {
  if (import.meta.env.FIREFOX && tabId !== undefined) {
    void sendMessage(MessageType.RemoveScrubIframe, { id }, tabId);
    return;
  }

  sendToOffscreen(OffscreenMessageType.RemoveIframe, { id });
}
