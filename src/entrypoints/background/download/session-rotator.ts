import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { extractPoTokenFromBody, getCapturedSabrData, onSabrBodyCaptured } from "@/lib/youtube/sabr-request-capture";

const SESSION_REFRESH_TIMEOUT_MS = 15_000;

export async function rotateSabrSession({ videoId, tabId, stalePoToken }: {
  videoId: string;
  tabId: number;
  stalePoToken: string;
}) {
  const watchUrl = `https://www.youtube.com/watch?${new URLSearchParams({
    v: videoId,
    ytdl: "1",
    mute: "1",
    r: String(Date.now())
  }).toString()}`;

  const freshCapture = waitForFreshCapture({ tabId, stalePoToken });
  void sendMessage(MessageType.RefreshDownloadIframe, { videoId, watchUrl }, tabId);
  return freshCapture;
}

function waitForFreshCapture({ tabId, stalePoToken }: {
  tabId: number;
  stalePoToken: string;
}): Promise<{ sabrUrl: string; poToken: string } | null> {
  return new Promise(resolve => {
    const timeoutId = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, SESSION_REFRESH_TIMEOUT_MS);

    const unsubscribe = onSabrBodyCaptured(capturedTabId => {
      if (capturedTabId !== tabId) {
        return;
      }

      const captured = getCapturedSabrData(tabId);
      if (!captured) {
        return;
      }

      const poToken = extractPoTokenFromBody(captured.body);
      if (!poToken || poToken === stalePoToken) {
        return;
      }

      clearTimeout(timeoutId);
      unsubscribe();
      resolve({ sabrUrl: captured.url, poToken });
    });
  });
}
