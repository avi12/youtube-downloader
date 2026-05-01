import { openScrubIframe } from "./iframe-lifecycle";
import { finalizeSession } from "./session-finalizer";
import { globalInFlightIframeIds, sessionsByVideoId } from "./session-store";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";

const MAX_GLOBAL_PARALLEL_IFRAMES = 1;
const IFRAME_SPAWN_STAGGER_MS = 200;
const SCRUB_TAG = "[ytdl:scrub-bg]";

export function logScrubOrchestratorEvent(message: string) {
  void broadcastDebugLogToYouTubeTabs(`${SCRUB_TAG} ${message}`);
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
