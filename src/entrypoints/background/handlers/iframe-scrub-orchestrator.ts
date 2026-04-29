import { ensureProcessor } from "./processor";
import { openScrubIframe } from "./scrub-iframe-lifecycle";
import { handleSegmentArrival } from "./scrub-segment-handler";
import { finalizeSession, releaseSession } from "./scrub-session-finalizer";
import { buildSession, globalInFlightIframeIds, sessionsByVideoId } from "./scrub-session-store";
import type { ScrubSession } from "./scrub-session-types";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { ScrubIframeMessageType, listenForScrubIframeMessages } from "@/lib/messaging/scrub-iframe-messaging";
import { ProgressType } from "@/types";
import type { AdaptiveFormatItem, CaptionTrack, DownloadType, VideoMetadata } from "@/types";

export type { SegmentArrival } from "./scrub-segment-handler";

const MAX_GLOBAL_PARALLEL_IFRAMES = 2;
const DEFAULT_STEP_SEC = 35;
const SCRUB_TAG = "[ytdl:scrub-bg]";
const IFRAME_SPAWN_STAGGER_MS = 200;

export interface StartIframeScrubArgs {
  videoId: string;
  durationSec: number;
  stepSec?: number;
  type: DownloadType;
  filenameOutput: string;
  videoMimeType: string;
  audioMimeType: string;
  audioLabel: string;
  metadata?: VideoMetadata | null;
  playlistId?: string;
  playlistTitle?: string;
  playlistTotalCount?: number;
  tabId: number;
  additionalAudioFormats?: AdaptiveFormatItem[];
  resolvedExtraAudioUrls?: (string | null)[];
  captionTracks?: CaptionTrack[];
}

function logScrubOrchestratorEvent(message: string) {
  void broadcastDebugLogToYouTubeTabs(`${SCRUB_TAG} ${message}`);
}

function reportFetchProgress(session: ScrubSession) {
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

async function fillGlobalSlots() {
  while (globalInFlightIframeIds.size < MAX_GLOBAL_PARALLEL_IFRAMES) {
    const sessions = Array.from(sessionsByVideoId.values());
    let found = false;
    for (const session of sessions) {
      const scrubIndex = session.pendingIndices.shift();
      if (scrubIndex === undefined) {
        continue;
      }

      found = true;
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

    if (!found) {
      break;
    }
  }
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
  logScrubOrchestratorEvent(`starting ${expectedCount} scrub iframes for ${data.videoId}`);
  await fillGlobalSlots();
}

export function cancelIframeScrubSession(videoId: string) {
  const session = sessionsByVideoId.get(videoId);
  if (session) {
    releaseSession(session);
  }
}

function registerScrubIframePort() {
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
}

function registerStartHandler() {
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
}

function registerLegacySendMessageHandler() {
  onMessage(MessageType.IframeScrubSegmentReady, async ({ data }) => {
    await handleSegmentArrival(data, logScrubOrchestratorEvent, fillGlobalSlots);
  });
}

export function registerIframeScrubOrchestrator() {
  registerScrubIframePort();
  registerStartHandler();
  registerLegacySendMessageHandler();
}

export { reportFetchProgress };
