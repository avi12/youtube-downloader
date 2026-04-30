import { fetchExtraAudioTracksAndCaptions } from "../download/extra-tracks-fetcher";
import { ensureProcessor } from "../handlers/processor";
import { untrackIframe } from "./iframe-lifecycle";
import { sessionsByVideoId } from "./session-store";
import type { ReceivedSegment, ScrubSession } from "./session-store";
import { OffscreenMessageType, sendBytesToOffscreen, sendToOffscreen } from "@/lib/messaging/offscreen-messaging";
import { base64ToUint8Array, uint8ToBase64 } from "@/lib/utils/binary";
import { extractInit, prependInitIfMissing } from "@/lib/utils/media-init";

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

function emitExtraAudioChunks({ session, iTrack, data }: {
  session: ScrubSession;
  iTrack: number;
  data: Uint8Array;
}) {
  return sendBytesToOffscreen({
    videoId: session.videoId,
    streamType: `audio-extra-${iTrack}`,
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

function ensureInitForAllSegments(
  segments: Map<number, ReceivedSegment>,
  videoMimeType: string,
  audioMimeType: string,
  logFn: (msg: string) => void
) {
  let videoInit: Uint8Array | undefined;
  let audioInit: Uint8Array | undefined;

  for (const [, segment] of segments) {
    if (segment.videoBase64) {
      const videoBytes = base64ToUint8Array(segment.videoBase64);
      const init = extractInit(videoBytes, videoMimeType);
      if (init) {
        videoInit = init;
      }
    }

    if (segment.audioBase64) {
      const audioBytes = base64ToUint8Array(segment.audioBase64);
      const init = extractInit(audioBytes, audioMimeType);
      if (init) {
        audioInit = init;
      }
    }

    if (videoInit && audioInit) {
      break;
    }
  }

  logFn(`[ensureInit] found videoInit=${videoInit?.byteLength ?? "none"} audioInit=${audioInit?.byteLength ?? "none"} videoMime=${videoMimeType} audioMime=${audioMimeType}`);

  if (!videoInit && !audioInit) {
    return;
  }

  let videoPatchCount = 0;
  let audioPatchCount = 0;

  for (const [index, segment] of segments) {
    if (videoInit && segment.videoBase64) {
      const videoBytes = base64ToUint8Array(segment.videoBase64);
      const patched = prependInitIfMissing(videoBytes, videoInit, videoMimeType);
      if (patched !== videoBytes) {
        videoPatchCount++;
        segments.set(index, {
          ...segment,
          videoBase64: uint8ToBase64(patched)
        });
      }
    }

    if (audioInit && segment.audioBase64) {
      const audioBytes = base64ToUint8Array(segment.audioBase64);
      const patched = prependInitIfMissing(audioBytes, audioInit, audioMimeType);
      if (patched !== audioBytes) {
        audioPatchCount++;
        segments.set(index, {
          ...segments.get(index)!,
          audioBase64: uint8ToBase64(patched)
        });
      }
    }
  }

  logFn(`[ensureInit] patched ${videoPatchCount} video segs, ${audioPatchCount} audio segs`);
}

function applyPrefetchedInits(
  session: ScrubSession,
  videoMimeType: string,
  audioMimeType: string,
  logFn: (msg: string) => void
) {
  const videoInit = session.prefetchedVideoInit;
  const audioInit = session.prefetchedAudioInit;

  logFn(`[applyPrefetchedInits] videoInit=${videoInit?.byteLength ?? "none"} audioInit=${audioInit?.byteLength ?? "none"}`);

  if (!videoInit && !audioInit) {
    return;
  }

  for (const [index, segment] of session.receivedSegments) {
    let updated = segment;
    if (videoInit && segment.videoBase64) {
      const videoBytes = base64ToUint8Array(segment.videoBase64);
      const patched = prependInitIfMissing(videoBytes, videoInit, videoMimeType);
      if (patched !== videoBytes) {
        updated = {
          ...updated,
          videoBase64: uint8ToBase64(patched)
        };
      }
    }

    if (audioInit && segment.audioBase64) {
      const audioBytes = base64ToUint8Array(segment.audioBase64);
      const patched = prependInitIfMissing(audioBytes, audioInit, audioMimeType);
      if (patched !== audioBytes) {
        updated = {
          ...updated,
          audioBase64: uint8ToBase64(patched)
        };
      }
    }

    if (updated !== segment) {
      session.receivedSegments.set(index, updated);
    }
  }
}

export async function finalizeSession(session: ScrubSession, logFn: (msg: string) => void) {
  logFn(`finalizeSession start: ${session.receivedSegments.size}/${session.expectedCount} segments for ${session.videoId}`);
  await ensureProcessor();
  logFn(`finalizeSession processor ready for ${session.videoId}`);

  const videoMime = session.resolvedVideoMimeType || session.videoMimeType;
  const audioMime = session.resolvedAudioMimeType || session.audioMimeType;
  ensureInitForAllSegments(session.receivedSegments, videoMime, audioMime, logFn);
  applyPrefetchedInits(session, videoMime, audioMime, logFn);

  for (const [scrubIndex, segment] of session.receivedSegments) {
    await Promise.all([
      emitSegmentChunks({
        session,
        scrubIndex,
        base64: segment.videoBase64,
        mediaKind: "video"
      }),
      emitSegmentChunks({
        session,
        scrubIndex,
        base64: segment.audioBase64,
        mediaKind: "audio"
      })
    ]);
  }

  logFn(`finalizing: captionTracks=${session.captionTracks.length} extraAudioFormats=${session.additionalAudioFormats.length}`);
  const { extraAudioTracks, subtitleStreams } = await fetchExtraAudioTracksAndCaptions({
    additionalAudioFormats: session.additionalAudioFormats,
    resolvedExtraAudioUrls: session.resolvedExtraAudioUrls,
    captionTracks: session.captionTracks
  });
  logFn(`extras fetched: extraAudio=${extraAudioTracks.length} subtitles=${subtitleStreams.length}`);

  for (const [iTrack, track] of extraAudioTracks.entries()) {
    await emitExtraAudioChunks({
      session,
      iTrack,
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

  const segmentVideoBufferEndSecs: (number | undefined)[] = Array.from(
    { length: session.expectedCount },
    (_, i) => session.receivedSegments.get(i)?.videoBufferEndSec
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
    segmentVideoBufferEndSecs,
    tabId: session.tabId,
    playlistId: session.playlistId,
    playlistTitle: session.playlistTitle,
    playlistTotalCount: session.playlistTotalCount,
    metadata: session.metadata
  });

  releaseSession(session);
}
