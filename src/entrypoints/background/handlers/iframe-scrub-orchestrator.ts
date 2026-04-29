import { ensureProcessor } from "./processor";
import { handleSegmentArrival } from "./scrub-segment-handler";
import { releaseSession } from "./scrub-session-finalizer";
import { buildSession, sessionsByVideoId } from "./scrub-session-store";
import { fillGlobalSlots, logScrubOrchestratorEvent, reportFetchProgress } from "./scrub-slot-filler";
import { broadcastDebugLogToYouTubeTabs } from "@/lib/messaging/debug-log";
import { MessageType, onMessage, sendMessage } from "@/lib/messaging/messaging";
import { ScrubIframeMessageType, listenForScrubIframeMessages } from "@/lib/messaging/scrub-iframe-messaging";
import type { AdaptiveFormatItem, CaptionTrack, DownloadType, VideoMetadata } from "@/types";

export type { SegmentArrival } from "./scrub-segment-handler";
export { reportFetchProgress };

const DEFAULT_STEP_SEC = 35;

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
