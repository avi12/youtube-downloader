import { ensureProcessor } from "../handlers/processor";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";

export async function spawnHostedIframe({ id, url }: {
  id: string;
  url: string;
}) {
  await ensureProcessor();
  sendToOffscreen(OffscreenMessageType.SpawnIframe, {
    id,
    url
  });
}

export function removeHostedIframe(id: string) {
  sendToOffscreen(OffscreenMessageType.RemoveIframe, { id });
}
