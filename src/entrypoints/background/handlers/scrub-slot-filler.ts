import { openScrubIframe } from "./scrub-iframe-lifecycle";
import { finalizeSession } from "./scrub-session-finalizer";
import { globalInFlightIframeIds, sessionsByVideoId } from "./scrub-session-store";
import type { ScrubSession } from "./scrub-session-store";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";

const MAX_GLOBAL_PARALLEL_IFRAMES = 2;
const IFRAME_SPAWN_STAGGER_MS = 200;
const SCRUB_TAG = "[ytdl:scrub-bg]";

export function logScrubOrchestratorEvent(message: string) {
  void broadcastDebugLogToYouTubeTabs(`${SCRUB_TAG} ${message}`);
}

export function reportFetchProgress(session: ScrubSession) {
  if (session.expectedCount === 0) {
    return;
  }

  const fraction = Math.min(session.receivedSegments.size / session.expectedCount, 1);
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId: session.videoId,
    progress: fraction,
    progressType: ProgressType.Video
  }, session.tabId);
}

export async function fillGlobalSlots() {
  while (globalInFlightIframeIds.size < MAX_GLOBAL_PARALLEL_IFRAMES) {
    const sessions = Array.from(sessionsByVideoId.values());
    let isFound = false;
    for (const session of sessions) {
      const scrubIndex = session.pendingIndices.shift();
      if (scrubIndex === undefined) {
        continue;
      }

      isFound = true;
      const startSec = scrubIndex * session.stepSec;
      const windowSec = Math.min(session.stepSec, session.durationSec - startSec);
      await openScrubIframe({
        session,
        scrubIndex,
        startSec,
        windowSec,
        logFn: logScrubOrchestratorEvent,
        onExpired() {
          if (session.receivedSegments.size >= session.expectedCount) {
            void finalizeSession(session, logScrubOrchestratorEvent);
            return;
          }

          void fillGlobalSlots();
        }
      });

      if (globalInFlightIframeIds.size < MAX_GLOBAL_PARALLEL_IFRAMES) {
        await new Promise(resolve => setTimeout(resolve, IFRAME_SPAWN_STAGGER_MS));
      }

      break;
    }

    if (!isFound) {
      break;
    }
  }
}
