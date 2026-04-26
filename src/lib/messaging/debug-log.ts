import { MessageType, sendMessage } from "./messaging";

// Development-only diagnostic relays. Both helpers gate on
// import.meta.env.YTDL_DEV so production builds dead-code-eliminate the entire
// path — no main-thread cost from query, no network message, no console.log.

export function broadcastDebugLogToTab(message: string, tabId: number) {
  if (!import.meta.env.YTDL_DEV) {
    return;
  }

  void sendMessage(MessageType.BgDebugLog, { msg: message }, tabId);
}

export async function broadcastDebugLogToYouTubeTabs(message: string) {
  if (!import.meta.env.YTDL_DEV) {
    return;
  }

  console.log(message);
  try {
    const tabs = await browser.tabs.query({ url: "https://www.youtube.com/*" });
    for (const tab of tabs) {
      if (typeof tab.id === "number") {
        void sendMessage(MessageType.BgDebugLog, { msg: message }, tab.id);
      }
    }
  } catch {
    // best-effort — diagnostics are non-load-bearing
  }
}
