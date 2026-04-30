import { ensureProcessor } from "../handlers/processor";
import { ensureScrubHostTab } from "../scrub/scrub-host-tab";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { OffscreenMessageType, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";

export async function spawnHostedIframe({ id, url }: {
  id: string;
  url: string;
}) {
  if (import.meta.env.FIREFOX) {
    const tabId = await ensureScrubHostTab();
    await sendMessage(MessageType.MountScrubIframeInTab, {
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

export function removeHostedIframe(id: string) {
  if (import.meta.env.FIREFOX) {
    void ensureScrubHostTab().then(tabId => {
      void sendMessage(MessageType.UnmountScrubIframeInTab, { id }, tabId);
    });
    return;
  }

  sendToOffscreen(OffscreenMessageType.RemoveIframe, { id });
}
