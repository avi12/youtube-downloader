import { ensureProcessor } from "../handlers/processor";
import { fillGlobalSlots, logScrubOrchestratorEvent } from "./iframe-scheduler";
import { handleSegmentArrival } from "./segment-handler";
import { releaseSession } from "./session-finalizer";
import { buildSession, sessionsByVideoId } from "./session-store";
import type { StartIframeScrubArgs, ScrubSession } from "./session-store";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { ScrubIframeMessageType, listenForScrubIframeMessages } from "@/lib/messaging/scrub-iframe-messaging";
import type { AdaptiveFormatItem } from "@/types";

export type { StartIframeScrubArgs } from "./session-store";

const DEFAULT_STEP_SEC = 35;

async function fetchInitBytesFromFormat(
  format: AdaptiveFormatItem | null | undefined,
  label: string
): Promise<Uint8Array | undefined> {
  if (!format) {
    logScrubOrchestratorEvent(`fetchInit[${label}] no format`);
    return undefined;
  }

  if (!format.url) {
    logScrubOrchestratorEvent(`fetchInit[${label}] no url (itag=${format.itag})`);
    return undefined;
  }

  if (!format.initRange) {
    logScrubOrchestratorEvent(`fetchInit[${label}] no initRange (itag=${format.itag})`);
    return undefined;
  }

  try {
    const url = `${format.url}&range=${format.initRange.start}-${format.initRange.end}`;
    const response = await fetch(url);
    logScrubOrchestratorEvent(`fetchInit[${label}] itag=${format.itag} status=${response.status} bytes=${response.headers.get("content-length") ?? "?"}`);

    if (!response.ok) {
      return undefined;
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch (e) {
    logScrubOrchestratorEvent(`fetchInit[${label}] threw: ${String(e)}`);
    return undefined;
  }
}

async function prefetchFormatInits(session: ScrubSession) {
  const [videoInit, audioInit] = await Promise.all([
    fetchInitBytesFromFormat(session.videoFormat, "video"),
    fetchInitBytesFromFormat(session.audioFormat, "audio")
  ]);

  logScrubOrchestratorEvent(`prefetchedInits videoId=${session.videoId} videoInit=${videoInit?.byteLength ?? "none"} audioInit=${audioInit?.byteLength ?? "none"}`);
  session.prefetchedVideoInit = videoInit;
  session.prefetchedAudioInit = audioInit;
}

export async function startIframeScrubSession(data: StartIframeScrubArgs) {
  const stepSec = data.stepSec || DEFAULT_STEP_SEC;
  const expectedCount = Math.max(1, Math.ceil(data.durationSec / stepSec));
  const session = buildSession(data, stepSec, expectedCount);

  sessionsByVideoId.set(data.videoId, session);
  void sendMessage(MessageType.StartKeepalive, { videoId: data.videoId }, data.tabId);
  void ensureProcessor().catch(error => {
    logScrubOrchestratorEvent(`ensureProcessor failed: ${String(error)}`);
  });

  // Fetch init segments immediately while the signed URLs are still fresh.
  // By the time finalizeSession runs (minutes later), the URLs have expired.
  void prefetchFormatInits(session).catch(error => {
    logScrubOrchestratorEvent(`prefetchFormatInits failed: ${String(error)}`);
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
      logScrubOrchestratorEvent(`iframe port hello videoId=${data.videoId} index=${data.iScrub}`);
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
