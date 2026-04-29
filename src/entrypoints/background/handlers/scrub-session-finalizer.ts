import { fetchExtraAudioTracksAndCaptions } from "../download/extra-tracks-fetcher";
import { ensureProcessor } from "./processor";
import { untrackIframe } from "./scrub-iframe-lifecycle";
import { rememberResolvedMimes, sessionsByVideoId } from "./scrub-session-store";
import type { ScrubSession } from "./scrub-session-types";
import { OffscreenMessageType, sendBytesToOffscreen, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { base64ToUint8Array } from "@/lib/utils/binary";

function emitSegmentChunks({ session, scrubIndex, base64, mediaKind }: {
  session: ScrubSession;
  scrubIndex: number;
  base64: string;
  mediaKind: "video" | "audio";
}) {
  return sendBytesToOffscreen({
    videoId: session.videoId,
    streamType: `${mediaKind}-seg-${scrubIndex}`,
    data: base64ToUint8Array(base64),
    tabId: session.tabId
  });
}

function emitExtraAudioChunks({ session, trackIndex, data }: {
  session: ScrubSession;
  trackIndex: number;
  data: Uint8Array;
}) {
  return sendBytesToOffscreen({
    videoId: session.videoId,
    streamType: `audio-extra-${trackIndex}`,
    data,
    tabId: session.tabId
  });
}

export function releaseSession(session: ScrubSession) {
  for (const iframeId of Array.from(session.inFlightIframeIds)) {
    untrackIframe({
      session,
      iframeId
    });
  }

  sessionsByVideoId.delete(session.videoId);
}

export async function finalizeSession(session: ScrubSession, logFn: (msg: string) => void) {
  logFn(`finalizeSession start: ${session.receivedSegments.size}/${session.expectedCount} segments for ${session.videoId}`);
  await ensureProcessor();
  logFn(`finalizeSession processor ready for ${session.videoId}`);

  for (const [scrubIndex, segment] of session.receivedSegments) {
    rememberResolvedMimes({
      session,
      segment
    });
    await emitSegmentChunks({
      session,
      scrubIndex,
      base64: segment.videoBase64,
      mediaKind: "video"
    });
    await emitSegmentChunks({
      session,
      scrubIndex,
      base64: segment.audioBase64,
      mediaKind: "audio"
    });
  }

  logFn(`finalizing: captionTracks=${session.captionTracks.length} extraAudioFormats=${session.additionalAudioFormats.length}`);
  const { extraAudioTracks, subtitleStreams } = await fetchExtraAudioTracksAndCaptions({
    additionalAudioFormats: session.additionalAudioFormats,
    resolvedExtraAudioUrls: session.resolvedExtraAudioUrls,
    captionTracks: session.captionTracks
  });
  logFn(`extras fetched: extraAudio=${extraAudioTracks.length} subtitles=${subtitleStreams.length}`);

  for (const [trackIndex, track] of extraAudioTracks.entries()) {
    await emitExtraAudioChunks({
      session,
      trackIndex,
      data: track.data
    });
  }

  const audioTrackLabels = [
    session.audioLabel,
    ...extraAudioTracks.map(track => track.label)
  ];

  const segmentVideoBufferStartSecs: (number | undefined)[] = Array.from(
    { length: session.expectedCount },
    (_, i) => session.receivedSegments.get(i)?.videoBufferStartSec
  );

  sendToOffscreen(OffscreenMessageType.ProcessStreamEnd, {
    type: session.type,
    videoId: session.videoId,
    filenameOutput: session.filenameOutput,
    videoMimeType: session.resolvedVideoMimeType || session.videoMimeType,
    audioMimeType: session.resolvedAudioMimeType || session.audioMimeType,
    audioTrackLabels,
    subtitleStreams,
    segmentCount: session.expectedCount,
    segmentDurationSec: session.stepSec,
    totalDurationSec: session.durationSec,
    segmentVideoBufferStartSecs,
    tabId: session.tabId,
    playlistId: session.playlistId,
    playlistTitle: session.playlistTitle,
    playlistTotalCount: session.playlistTotalCount,
    metadata: session.metadata
  });

  releaseSession(session);
}
