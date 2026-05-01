import { untrackIframe } from "./iframe-lifecycle";
import { finalizeSession } from "./session-finalizer";
import { iframeIdByVideoIdAndIndex, makeIframeKey, sessionsByVideoId } from "./session-store";
import type { ReceivedSegment, SegmentArrival, ScrubSession } from "./session-store";
import { MessageType, sendMessage } from "@/lib/messaging/messaging";
import { ProgressType } from "@/types";

const MAX_RETRIES_PER_INDEX = 4;
const RETRY_DELAY_BASE_MS = 1500;
const MIN_ACCEPTABLE_BYTES_PER_SEC = 50_000;
const MIN_ACCEPTABLE_AUDIO_BYTES_PER_SEC = 16_000;

function isSegmentTooSmall({ session, iScrub, videoBytes, audioBytes }: {
  session: ScrubSession;
  iScrub: number;
  videoBytes: number;
  audioBytes: number;
}) {
  const windowSec = Math.min(session.stepSec, session.durationSec - iScrub * session.stepSec);
  const totalBytes = videoBytes + audioBytes;
  return totalBytes < MIN_ACCEPTABLE_BYTES_PER_SEC * windowSec
    || audioBytes < MIN_ACCEPTABLE_AUDIO_BYTES_PER_SEC * windowSec;
}

export async function handleSegmentArrival(
  data: SegmentArrival,
  logFn: (msg: string) => void,
  fillGlobalSlots: () => Promise<void>
) {
  const session = sessionsByVideoId.get(data.videoId);
  if (!session) {
    return;
  }

  const iframeKey = makeIframeKey(data.videoId, data.iScrub);
  const iframeId = iframeIdByVideoIdAndIndex.get(iframeKey);
  if (!iframeId) {
    return;
  }

  untrackIframe({
    session,
    iframeId,
    iScrub: data.iScrub
  });

  const videoBytes = data.videoBytes.byteLength;
  const audioBytes = data.audioBytes.byteLength;
  const attempts = session.attemptsByIndex.get(data.iScrub) ?? 0;
  if (isSegmentTooSmall({
    session,
    iScrub: data.iScrub,
    videoBytes,
    audioBytes
  }) && attempts < MAX_RETRIES_PER_INDEX) {
    session.attemptsByIndex.set(data.iScrub, attempts + 1);
    session.pendingIndices.push(data.iScrub);
    logFn(`segment ${data.iScrub} undersized (video=${videoBytes}B audio=${audioBytes}B), retrying ${attempts + 2}/${MAX_RETRIES_PER_INDEX + 1}`);
    await new Promise(resolve => setTimeout(resolve, (attempts + 1) * RETRY_DELAY_BASE_MS));
    await fillGlobalSlots();
    return;
  }

  session.receivedSegments.set(
    data.iScrub, {
      videoBytes: data.videoBytes,
      audioBytes: data.audioBytes,
      videoMimeType: data.videoMimeType,
      audioMimeType: data.audioMimeType,
      videoBufferStartSec: data.videoBufferStartSec,
      videoBufferEndSec: data.videoBufferEndSec
    } satisfies ReceivedSegment
  );

  logFn(`received segment ${data.iScrub + 1}/${session.expectedCount} for ${data.videoId} (video=${videoBytes}B audio=${audioBytes}B)`);

  // Drive the watch-page progress ring's capture phase (first 80%) by mapping
  // segment-arrival count to a 0..1 fraction. The page-side mapToBarProgress
  // scales Video-typed progress into the 0..0.8 ring share; FFmpeg progress
  // takes over for the remaining 0.8..1.0 once segments finish capturing.
  void sendMessage(MessageType.UpdateDownloadProgress, {
    videoId: data.videoId,
    progress: session.receivedSegments.size / session.expectedCount,
    progressType: ProgressType.Video
  }, session.tabId);

  if (session.receivedSegments.size >= session.expectedCount) {
    await finalizeSession(session, logFn);
    await fillGlobalSlots();
    return;
  }

  await fillGlobalSlots();
}
