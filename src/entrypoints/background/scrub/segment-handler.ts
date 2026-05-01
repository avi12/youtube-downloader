import { untrackIframe } from "./iframe-lifecycle";
import { finalizeSession } from "./session-finalizer";
import { iframeIdByVideoIdAndIndex, makeIframeKey, sessionsByVideoId } from "./session-store";
import type { ReceivedSegment, SegmentArrival, ScrubSession } from "./session-store";

const MAX_RETRIES_PER_INDEX = 2;
const MIN_ACCEPTABLE_BYTES_PER_SEC = 50_000;
const MIN_ACCEPTABLE_AUDIO_BYTES_PER_SEC = 16_000;

function isSegmentTooSmall({ session, scrubIndex, videoBytes, audioBytes }: {
  session: ScrubSession;
  scrubIndex: number;
  videoBytes: number;
  audioBytes: number;
}) {
  const windowSec = Math.min(session.stepSec, session.durationSec - scrubIndex * session.stepSec);
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

  const iframeKey = makeIframeKey(data.videoId, data.scrubIndex);
  const iframeId = iframeIdByVideoIdAndIndex.get(iframeKey);
  if (!iframeId) {
    return;
  }

  untrackIframe({
    session,
    iframeId,
    scrubIndex: data.scrubIndex
  });

  const videoBytes = data.videoBytes.byteLength;
  const audioBytes = data.audioBytes.byteLength;
  const attempts = session.attemptsByIndex.get(data.scrubIndex) ?? 0;
  if (isSegmentTooSmall({
    session,
    scrubIndex: data.scrubIndex,
    videoBytes,
    audioBytes
  }) && attempts < MAX_RETRIES_PER_INDEX) {
    session.attemptsByIndex.set(data.scrubIndex, attempts + 1);
    session.pendingIndices.push(data.scrubIndex);
    logFn(`segment ${data.scrubIndex} undersized (video=${videoBytes}B audio=${audioBytes}B), retrying ${attempts + 2}/${MAX_RETRIES_PER_INDEX + 1}`);
    await fillGlobalSlots();
    return;
  }

  session.receivedSegments.set(
    data.scrubIndex, {
      videoBytes: data.videoBytes,
      audioBytes: data.audioBytes,
      videoMimeType: data.videoMimeType,
      audioMimeType: data.audioMimeType,
      videoBufferStartSec: data.videoBufferStartSec,
      videoBufferEndSec: data.videoBufferEndSec
    } satisfies ReceivedSegment
  );

  logFn(`received segment ${data.scrubIndex + 1}/${session.expectedCount} for ${data.videoId} (video=${videoBytes}B audio=${audioBytes}B)`);

  if (session.receivedSegments.size >= session.expectedCount) {
    await finalizeSession(session, logFn);
    await fillGlobalSlots();
    return;
  }

  await fillGlobalSlots();
}
