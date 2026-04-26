import { MessageType, sendMessage } from "./messaging";

// Dev-only diagnostic relay — forwards a message to a single tab's content
// script, which logs it to the page console. Stripped from production builds
// via the import.meta.env.YTDL_DEV guard so download hot paths stay quiet.
export function debugLogToTab(msg: string, tabId: number) {
  if (!import.meta.env.YTDL_DEV) {
    return;
  }

  void sendMessage(MessageType.BgDebugLog, { msg }, tabId);
}

// Same idea, but fans the message out to every YouTube tab. Useful for diags
// originating in the BG iframe-host where there's no single owning tab.
export async function debugLogToAllYouTubeTabs(msg: string) {
  if (!import.meta.env.YTDL_DEV) {
    return;
  }

  console.log(msg);
  try {
    const tabs = await browser.tabs.query({ url: "https://www.youtube.com/*" });
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        void sendMessage(MessageType.BgDebugLog, { msg }, tab.id);
      }
    }
  } catch {
    // best-effort — diag is non-load-bearing
  }
}
