import { MessageType, sendMessage } from "./messaging";

export function broadcastDebugLogToTab(message: string, tabId: number) {
  void sendMessage(MessageType.BgDebugLog, { msg: message }, tabId);
}

export async function broadcastDebugLogToYouTubeTabs(message: string) {
  console.log(message);
  try {
    const tabs = await browser.tabs.query({ url: "https://www.youtube.com/*" });
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        void sendMessage(MessageType.BgDebugLog, { msg: message }, tab.id);
      }
    }
  } catch {
    // best-effort - diagnostics are non-load-bearing
  }
}
