import { ensureProcessor } from "../handlers/processor";
import { handleSegmentArrival } from "./segment-handler";
import { releaseSession } from "./session-finalizer";
import { buildSession, sessionsByVideoId } from "./session-store";
import type { StartIframeScrubArgs } from "./session-store";
import { fillGlobalSlots, logScrubOrchestratorEvent } from "./slot-filler";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { ScrubIframeMessageType, listenForScrubIframeMessages } from "@/lib/messaging/scrub-iframe-messaging";

export type { StartIframeScrubArgs } from "./session-store";

const DEFAULT_STEP_SEC = 35;

export async function startIframeScrubSession(data: StartIframeScrubArgs) {
  const stepSec = data.stepSec || DEFAULT_STEP_SEC;
  const expectedCount = Math.max(1, Math.ceil(data.durationSec / stepSec));
  const session = buildSession(data, stepSec, expectedCount);

  sessionsByVideoId.set(data.videoId, session);
  void sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, data.tabId);
  void ensureProcessor().catch(error => {
    logScrubOrchestratorEvent(`ensureProcessor failed: ${String(error)}`);
  });
  logScrubOrchestratorEvent(`starting ${expectedCount} scrub iframes for ${data.videoId}`);
  await fillGlobalSlots();
}

export function cancelIframeScrubSession(videoId: string) {
  const session = sessionsByVideoId.get(videoId);
  if (session) {
    releaseSession(session);
  }
}

export function registerIframeScrubOrchestrator() {
  listenForScrubIframeMessages({
    [ScrubIframeMessageType.Hello](data) {
      logScrubOrchestratorEvent(`iframe port hello videoId=${data.videoId} index=${data.scrubIndex}`);
    },
    [ScrubIframeMessageType.Debug](data) {
      void broadcastDebugLogToYouTubeTabs(data.msg);
    },
    [ScrubIframeMessageType.Segment](data) {
      handleSegmentArrival(data, logScrubOrchestratorEvent, fillGlobalSlots).catch(error => {
        logScrubOrchestratorEvent(`handleSegmentArrival error: ${String(error)}`);
      });
    }
  });

  onMessage(MessageType.StartIframeScrub, async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      return;
    }

    await startIframeScrubSession({
      ...data,
      tabId
    });
  });

  onMessage(MessageType.IframeScrubSegmentReady, async ({ data }) => {
    await handleSegmentArrival(data, logScrubOrchestratorEvent, fillGlobalSlots);
  });
}
